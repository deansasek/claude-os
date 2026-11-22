package hub.kiosk.ime;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The words Claude Keyboard suggests: a small bundled English list (assets/ime/words.txt, most common first)
 * and the words this tablet's user has typed (a private file in the app's storage). Typed words are never
 * logged, never sent anywhere, and never learned from password or email fields (the keyboard checks that).
 *
 * The keyboard runs on the main thread, so nothing here does file or asset I/O on a key press: the list is read
 * and indexed once, on a background thread, and until then suggest() and correction() return nothing.
 */
final class Words {
  private static final int MAX_LEARNED = 2000, KEEP_LEARNED = 1500;
  private static final ExecutorService IO = Executors.newSingleThreadExecutor();
  private static Words instance;

  // the bundled list, built by the loader thread; read only once ready is set (volatile publishes the fields)
  private volatile boolean ready;
  private String[] byRank = new String[0];   // the list, de-duplicated, most common first
  private String[] lex = new String[0];      // the same words sorted A to Z, for prefix search
  private int[] rankAt = new int[0];         // rankAt[i]: the rank (index into byRank) of lex[i]
  private String[][] byLength = new String[0][];   // words by length, for correction candidates
  private HashSet<String> dictSet = new HashSet<>();

  // the user's own words: guarded by this
  private final Map<String, Integer> learned = new HashMap<>();
  private final File file;
  private boolean dirty;

  static synchronized Words get(Context c) {
    if (instance == null) instance = new Words(c.getApplicationContext());
    return instance;
  }

  private Words(Context c) {
    file = new File(c.getFilesDir(), "ime-learned.tsv");
    Thread loader = new Thread(() -> {
      build(loadDict(c));
      loadLearned();
      ready = true;
    }, "ime-words");
    loader.setDaemon(true);
    loader.start();
  }

  private static String[] loadDict(Context c) {
    List<String> out = new ArrayList<>();
    try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getAssets().open("ime/words.txt"), StandardCharsets.UTF_8))) {
      String line;
      while ((line = r.readLine()) != null) {
        for (String tok : line.trim().split("\\s+")) {
          if (!tok.isEmpty()) out.add(tok.toLowerCase(Locale.ROOT));
        }
      }
    } catch (IOException ignored) { }
    return out.toArray(new String[0]);
  }

  /** Builds the indexes: the rank order, a sorted copy for prefixes, and buckets by length for corrections. */
  private void build(String[] words) {
    LinkedHashSet<String> uniq = new LinkedHashSet<>(Arrays.asList(words));
    String[] rank = uniq.toArray(new String[0]);
    Integer[] order = new Integer[rank.length];
    for (int i = 0; i < order.length; i++) order[i] = i;
    Arrays.sort(order, (a, b) -> rank[a].compareTo(rank[b]));
    String[] sorted = new String[rank.length];
    int[] ranks = new int[rank.length];
    int maxLen = 0;
    for (int i = 0; i < order.length; i++) {
      sorted[i] = rank[order[i]];
      ranks[i] = order[i];
      maxLen = Math.max(maxLen, rank[i].length());
    }
    int[] count = new int[maxLen + 2];
    for (String w : rank) count[w.length()]++;
    String[][] buckets = new String[maxLen + 2][];
    for (int len = 0; len < buckets.length; len++) buckets[len] = new String[count[len]];
    int[] fill = new int[buckets.length];
    for (String w : rank) buckets[w.length()][fill[w.length()]++] = w;   // keeps rank order within a length
    HashSet<String> set = new HashSet<>(uniq);

    // publish: the fields are complete before ready is set (see the field comment)
    byRank = rank;
    lex = sorted;
    rankAt = ranks;
    byLength = buckets;
    dictSet = set;
  }

  private void loadLearned() {
    if (!file.exists()) return;
    Map<String, Integer> in = new HashMap<>();
    try (BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
      String line;
      while ((line = r.readLine()) != null) {
        int tab = line.indexOf('\t');
        if (tab <= 0) continue;
        try {
          in.put(line.substring(0, tab), Integer.parseInt(line.substring(tab + 1).trim()));
        } catch (NumberFormatException ignored) { }
      }
    } catch (IOException ignored) { }
    synchronized (this) {
      for (Map.Entry<String, Integer> e : in.entrySet()) learned.merge(e.getKey(), e.getValue(), Integer::sum);
    }
  }

  /** The word was typed in a learnable field: count it up (letters only, 2 to 24 long). */
  synchronized void learn(String word) {
    String w = word.toLowerCase(Locale.ROOT);
    if (w.length() < 2 || w.length() > 24) return;
    for (int i = 0; i < w.length(); i++) if (!Character.isLetter(w.charAt(i))) return;
    Integer n = learned.get(w);
    learned.put(w, n == null ? 1 : n + 1);
    if (learned.size() > MAX_LEARNED) prune();
    dirty = true;
  }

  private void prune() {
    List<Map.Entry<String, Integer>> es = new ArrayList<>(learned.entrySet());
    es.sort(Map.Entry.<String, Integer>comparingByValue());
    for (int i = 0; i < es.size() - KEEP_LEARNED; i++) learned.remove(es.get(i).getKey());
  }

  /** Writes the learned words to the app's storage, off the main thread, if they changed. */
  void save() {
    final String out;
    synchronized (this) {
      if (!dirty) return;
      dirty = false;
      StringBuilder sb = new StringBuilder();
      for (Map.Entry<String, Integer> e : learned.entrySet()) {
        sb.append(e.getKey()).append('\t').append(e.getValue()).append('\n');
      }
      out = sb.toString();
    }
    IO.execute(() -> write(out));
  }

  private void write(String s) {
    File tmp = new File(file.getPath() + ".tmp");
    try (Writer w = new OutputStreamWriter(new FileOutputStream(tmp), StandardCharsets.UTF_8)) {
      w.write(s);
    } catch (IOException e) {
      return;
    }
    if (!tmp.renameTo(file)) tmp.delete();
  }

  /** Forgets every learned word (the dictionary stays). */
  static void clearLearned(Context c) {
    Words w = get(c);
    synchronized (w) {
      w.learned.clear();
      w.dirty = false;
    }
    IO.execute(() -> { if (w.file.exists()) w.file.delete(); });
  }

  /** The first index in a sorted array whose word is not before key. */
  private static int lowerBound(String[] a, String key) {
    int lo = 0, hi = a.length;
    while (lo < hi) {
      int mid = (lo + hi) >>> 1;
      if (a[mid].compareTo(key) < 0) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /**
   * Words that start with this prefix: the user's own first (most typed), then the dictionary by rank. The dictionary
   * part is a binary search to the prefix's run in the sorted list, keeping the n best ranks seen in that run.
   */
  synchronized List<String> suggest(String prefix, int n) {
    List<String> out = new ArrayList<>();
    if (!ready || prefix.isEmpty()) return out;
    List<Map.Entry<String, Integer>> hits = new ArrayList<>();
    for (Map.Entry<String, Integer> e : learned.entrySet()) {
      if (e.getKey().startsWith(prefix)) hits.add(e);
    }
    hits.sort((a, b) -> b.getValue() - a.getValue());
    for (Map.Entry<String, Integer> e : hits) {
      if (out.size() >= n) break;
      out.add(e.getKey());
    }
    int[] best = new int[n];
    int count = 0;
    for (int i = lowerBound(lex, prefix); i < lex.length && lex[i].startsWith(prefix); i++) {
      int r = rankAt[i];
      if (count == n && r >= best[n - 1]) continue;
      int j = count < n ? count++ : n - 1;
      while (j > 0 && best[j - 1] > r) { best[j] = best[j - 1]; j--; }
      best[j] = r;
    }
    for (int k = 0; k < count && out.size() < n; k++) {
      String d = byRank[best[k]];
      if (!out.contains(d)) out.add(d);
    }
    return out;
  }

  private boolean known(String w) { return dictSet.contains(w) || learned.containsKey(w); }

  /**
   * The one word this lowercase word most likely means: a single-letter typo away from exactly one known word.
   * Only the words one letter shorter, the same length and one letter longer are looked at (length buckets).
   * Null when there is no such word, or more than one, so only a clear typo is changed.
   */
  synchronized String correction(String w) {
    if (!ready || w.length() < 3 || known(w)) return null;
    String found = null;
    int hits = 0;
    int from = Math.max(3, w.length() - 1), to = Math.min(byLength.length - 1, w.length() + 1);
    for (int len = from; len <= to; len++) {
      for (String d : byLength[len]) {
        if (oneEdit(w, d)) {
          found = d;
          if (++hits > 1) return null;
        }
      }
    }
    return hits == 1 ? found : null;
  }

  /** True when a and b differ by one letter, one insertion or deletion, or one swap of neighbours. */
  static boolean oneEdit(String a, String b) {
    int la = a.length(), lb = b.length();
    if (la == lb) {
      int diff = 0, first = -1;
      for (int i = 0; i < la; i++) {
        if (a.charAt(i) != b.charAt(i)) {
          if (diff == 0) first = i;
          if (++diff > 2) return false;
        }
      }
      if (diff == 1) return true;
      return diff == 2 && first + 1 < la && a.charAt(first) == b.charAt(first + 1) && a.charAt(first + 1) == b.charAt(first);
    }
    String s = la < lb ? a : b, t = la < lb ? b : a;
    int i = 0;
    while (i < s.length() && s.charAt(i) == t.charAt(i)) i++;
    return s.substring(i).equals(t.substring(i + 1));
  }
}
