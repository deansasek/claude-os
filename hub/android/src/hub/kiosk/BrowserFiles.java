package hub.kiosk;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;

/**
 * Files the Browser hands to web pages for uploads: a camera picture, or a Claude Home photo the page fetched.
 * They live in the app's cache folder, and only this provider reads them (exported = false; the camera app gets
 * a grant for the one Uri it is asked to write). Old files are removed when a new one is made.
 */
public class BrowserFiles extends ContentProvider {
  static final String AUTHORITY = "hub.kiosk.browserfiles";
  private static final long MAX_BYTES = 12L * 1024 * 1024;
  private static final long KEEP_MS = 24L * 60 * 60 * 1000;

  static File dir(Context c) {
    File d = new File(c.getCacheDir(), "browser-uploads");
    d.mkdirs();
    return d;
  }

  /** A new, empty file for the camera to write (old uploads are cleaned up). */
  static File newFile(Context c, String ext) {
    File d = dir(c);
    long now = System.currentTimeMillis();
    File[] old = d.listFiles();
    if (old != null) for (File f : old) if (now - f.lastModified() > KEEP_MS) f.delete();
    return new File(d, "cam-" + now + "." + ext);
  }

  static Uri uriFor(File f) {
    return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(f.getName()).build();
  }

  /** A JPEG/PNG data URL from a page, written to a new file; its Uri, or null when it's too big or not an image. */
  static Uri write(Context c, String dataUrl, String name) {
    try {
      if (dataUrl == null || !dataUrl.startsWith("data:") || dataUrl.indexOf(',') < 0) return null;
      int comma = dataUrl.indexOf(',');
      byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
      if (bytes.length == 0 || bytes.length > MAX_BYTES) return null;
      String safe = (name == null ? "photo.jpg" : name).replaceAll("[^A-Za-z0-9._-]", "_");
      if (!safe.matches(".*\\.(jpe?g|png|webp|gif)$")) safe = safe + ".jpg";
      File f = new File(dir(c), "photo-" + System.currentTimeMillis() + "-" + safe);
      try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
      return uriFor(f);
    } catch (IOException | IllegalArgumentException e) {
      return null;
    }
  }

  @Override public boolean onCreate() { return true; }

  @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    String name = uri.getLastPathSegment();
    if (name == null || !name.matches("[A-Za-z0-9._-]+")) throw new FileNotFoundException("no such upload");
    File f = new File(dir(getContext()), name);
    if (mode != null && mode.contains("w")) {
      return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
    }
    return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
  }

  @Override public String getType(Uri uri) {
    String n = String.valueOf(uri.getLastPathSegment()).toLowerCase();
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".webp")) return "image/webp";
    if (n.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
  }

  @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
  @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
  @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
  @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
