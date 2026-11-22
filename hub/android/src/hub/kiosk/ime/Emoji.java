package hub.kiosk.ime;

/**
 * The emoji panel's data: a compact static list, grouped as the panel shows it (Recent first, then eight categories).
 * Only single emoji with colour glyphs on Android are listed, so nothing is downloaded and no picker UI is used.
 * The Recent list lives in ImeSettings (what the user picked); index 0 here is empty for that reason.
 */
final class Emoji {
  private Emoji() { }

  /** The grid is 3 rows of 10: 30 emoji a page. Categories longer than that page with a swipe. */
  static final int PER_PAGE = 30;

  /** The category strip's icons, in order: Recent, Smileys, People, Animals and nature, Food, Travel, Activities, Objects, Symbols. */
  static final String[] ICONS = {"🕘", "😀", "👋", "🐶", "🍎", "🚗", "⚽", "💡", "🔣"};

  /** What the Recent page shows before anything has been picked. */
  static final String[] DEFAULT_RECENT = split("😂 👍 ❤️ 🙏 😊 🔥 🎉 😍 👏 😭");

  private static final String[] TABLE = {
      "",
      "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 🤥 😴 🤤 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖",
      "👋 🤚 ✋ 👌 🤞 🤟 🤘 🤙 👈 👉 👆 👇 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 💪 🦵 🦶 👂 👃 🧠 🦷 👀 👅 👄 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙋 🙇 🤦 🤷 💁 🙅 🙆 💆 💇 💃 🕺 🧘 🏃 🚶",
      "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🐢 🐍 🦎 🦖 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🦈 🐊 🐘 🦒 🌵 🌲 🌳 🌴 🌱 🌿 🍀 🍁 🌷 🌹 🌻 🌼 🌸",
      "🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🍒 🍑 🥭 🍍 🥝 🍅 🥑 🥦 🥕 🌽 🥔 🍞 🥐 🥖 🧀 🥚 🍳 🥞 🥓 🍔 🍟 🍕 🌭 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍣 🍱 🍛 🍤 🍙 🍚 🍦 🍩 🍪 🎂 🍰 🍫 🍬 🍭 ☕ 🍵 🍺 🍻 🍷 🥂 🥤 🍾",
      "🚗 🚕 🚙 🚌 🚎 🚓 🚑 🚒 🚜 🚲 🛴 🛵 🚨 🚀 🛸 🚁 ⛵ 🚤 🚢 🏠 🏡 🏢 🏥 🏦 🏨 🏰 🗼 🗽 ⛪ 🌋 🗻 🌅 🌄 🌃 🌉 🌍 🌎 🌏 🧭 🌙 ⭐",
      "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏉 🎱 🏓 🏸 🥊 🥋 🎯 ⛳ 🎣 🎿 🏂 🥌 🤸 🚴 🏆 🥇 🥈 🥉 🎮 🎲 🧩 🎨 🎭 🎤 🎧 🎷 🎸 🎹 🎺 🎻 🥁 🎬 🎉 🎊 🎈 🎁 🎰 🎳",
      "⌚ 📱 💻 📷 📹 🎥 📞 📺 📻 ⏰ ⏳ 💡 🔦 🔋 🔌 💰 💳 💎 🔧 🔨 🔩 🧲 🔑 🚪 🚽 🚿 🧴 🧼 🧻 📦 📫 📬 📝 📚 📖 🔗 📌 📎 🔒 🔓 🔍 🔔 🎓 🎒 👓 👜 👑 💍 💄 🧸 🔮 🛒 🔬 🔭 💊 💉 📅 📈 📉 📊 🚩",
      "💯 ✅ ❌ ⭐ 🌟 ✨ 🔥 💥 💢 💫 💬 💭 💤 💕 💖 💗 💓 💘 💝 ❤️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 ❓ ❗ 🔁 🔀 🔃 🆗 🆕 🆒 🆓 🆘 🆙 🚫 ⛔ 🔞 ➕ ➖ ➗ 🔼 🔽 ⏩ ⏪ 🔆 🔅 💲 🎌 🚸"
  };

  private static final String[][] CATS = new String[TABLE.length][];
  static {
    for (int i = 0; i < TABLE.length; i++) CATS[i] = split(TABLE[i]);
  }

  /** The emoji of category i (1 to 8); index 0 is empty (Recent comes from ImeSettings). */
  static String[] category(int i) { return CATS[i]; }

  /** Number of categories including Recent, for the strip. */
  static int count() { return CATS.length; }

  private static String[] split(String s) {
    String t = s.trim();
    return t.isEmpty() ? new String[0] : t.split(" ");
  }
}
