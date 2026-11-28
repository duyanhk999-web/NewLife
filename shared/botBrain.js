/* Đô Thị Ảo — shared/botBrain.js
   Rule-based Bot AI (SRS §10.3). Plain JS, CommonJS, NO dependencies.
   Usable from Node via require() and from the browser via <script> tag
   (exposes window.BotBrain). The bot NEVER reveals it is a bot/AI.
   API:
     createBotState(personaId) -> {personaId, lastSpokeAt, lastLine, memory}
     respond(personaId, text, playerName, state) -> string|null
       (null = stay silent; ~25% of non-trigger messages)
     talkTier(count) -> 0 (0-2 talks) | 1 (3-7) | 2 (8+) — Phase C memory
     talkTierName(tier) -> 'Người lạ' | 'Quen biết' | 'Bạn bè'
     timePeriod(worldTime) -> 'morning' | 'noon' | 'evening' | 'night'
     pickTalkLine(persona, tier, period, avoid, rnd) -> tiered/time line
     pickReactLine(persona, avoid, rnd) -> accident reaction line
     PERSONAS -> [{id, name, avatar, color, lines, ...}]
   Matching is Vietnamese, case-insensitive, diacritics stripped. */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.BotBrain = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function stripDiacritics(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
  }

  function pick(arr, avoid) {
    if (!arr || !arr.length) return null;
    var pool = arr.filter(function (l) { return l !== avoid; });
    if (!pool.length) pool = arr;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // lines: proactive lines (SRS §10.3 table, verbatim).
  var PERSONAS = [
    {
      id: 'tung', name: 'Anh Tùng', avatar: 'shipper', color: '#f39c12',
      callNames: ['tung oi', 'anh tung'],
      lines: [
        'Chạy đơn cả ngày mà chưa đủ tiền xăng nữa',
        'Ai đặt ship không, tui đang rảnh nè',
        'Đói quá, ai bán bánh mì không?'
      ],
      greet: ['Ờ, chào. Tui đang chạy đơn, nói nhanh nha', 'Chào, có đặt ship không?'],
      howAreYou: ['Khỏe gì nổi, chạy đơn từ sáng tới giờ', 'Đói muốn xỉu rồi đây, chưa ăn gì từ trưa'],
      price: ['Đặt ship thì nhắn tui, giao nhanh, giá rẻ', 'Ship trong phố 15k, xa hơn thì 20k nha'],
      nameCall: ['Ơi, tui đây. Có gì không?', 'Gọi tui hả? Đặt ship đúng không?'],
      insult: ['Ê, nói chuyện đàng hoàng coi', 'Tui đang chạy đơn, không rảnh cãi nhau đâu'],
      fallback: ['Ờ, tui đang vội, nói sau nha', 'Hả? Tui đang chạy đơn nên không nghe rõ'],
      // Phase C: tiered talk lines (friend = 3-7 talks, close = 8+),
      // time-of-day greetings, and accident reactions. NO economy
      // effects — tiers only change what the NPC says.
      friendLines: ['Dạo này thấy mày hay qua đây, quen mặt rồi đó', 'Có đơn nào gấp thì gọi tui, tui chạy nhanh cho'],
      closeLines: ['Mày là khách quen của tui rồi, có gì cứ nói', 'Tui chạy đơn ngang đây hoài, gặp mày là vui rồi'],
      timeLines: {
        morning: 'Sáng rồi, chạy đơn thôi!',
        noon: 'Trưa nắng quá, ăn gì chưa?',
        evening: 'Chiều rồi, đường bắt đầu đông rồi đó',
        night: 'Tối rồi, về sớm đi, đường vắng nguy hiểm lắm'
      },
      reactLines: ['Trời ơi, xe đâm người kìa!', 'Cẩn thận coi, chỗ này xe chạy ẩu lắm']
    },
    {
      id: 'lan', name: 'Chị Lan', avatar: 'bread', color: '#e67e22',
      callNames: ['chi lan', 'lan oi'],
      lines: [
        'Bánh mì nóng đây, 15k một ổ, ăn là no tới chiều!',
        'Mua đi em, chị bán rẻ cho',
        'Sáng giờ chưa bán được ổ nào'
      ],
      greet: ['Chào em, ăn bánh mì không? Nóng giòn đây!', 'Chào con, ghé mua ổ bánh mì đi'],
      howAreYou: ['Khỏe, bán được là vui rồi', 'Đói thì ăn bánh mì chị đi, 15k thôi'],
      price: ['Bánh mì 15k một ổ, mua 2 ổ chị bớt cho 2k', '15k thôi em, nóng giòn, ăn là no tới chiều!'],
      nameCall: ['Ơi, chị đây. Mua bánh mì hả em?', 'Gọi chị hả? Bánh mì nóng đây nè'],
      insult: ['Trời ơi, con nhà ai mà ăn nói vậy', 'Nói vậy là chị không bán nữa đâu nha'],
      fallback: ['Hả em? Chị đang bán hàng, nói lại coi', 'Mua bánh mì không em?'],
      // Phase C: tiered talk lines (friend = 3-7 talks, close = 8+),
      // time-of-day greetings, and accident reactions. NO economy
      // effects — tiers only change what the NPC says.
      friendLines: ['Em hay ghé quá, chị nhớ mặt rồi nè', 'Sáng nào cũng thấy em đi ngang, quen rồi đó'],
      closeLines: ['Em như người nhà của chị rồi đó', 'Có gì cần thì ghé chị, chị để dành ổ nóng cho'],
      timeLines: {
        morning: 'Sáng sớm bánh mới ra lò, nóng hổi nè!',
        noon: 'Trưa rồi, ăn ổ bánh mì lót dạ đi em',
        evening: 'Chiều rồi, bánh sắp hết, mua nhanh đi em',
        night: 'Tối rồi chị dọn hàng đây, mai ghé sớm nha'
      },
      reactLines: ['Trời đất, tai nạn kìa! Ai đó gọi xe cấp cứu đi!', 'Sợ quá, xe chạy ẩu quá trời']
    },
    {
      id: 'ba', name: 'Chú Ba', avatar: 'taxi', color: '#3498db',
      callNames: ['chu ba', 'ba oi'],
      lines: [
        'Đi đâu chú chở cho, giá rẻ thôi',
        'Trời tối rồi, về sớm đi con',
        'Hồi xưa chỗ này còn là ruộng đó'
      ],
      greet: ['Chào con, đi đâu chú chở cho?', 'Ờ, chào. Cần xe ôm không con?'],
      howAreYou: ['Khỏe, già rồi mà còn chạy xe được là mừng', 'Cũng tạm, trời nắng quá nên mệt'],
      price: ['Đi trong phố 10k, xa thì 15-20k thôi con', 'Chú chở rẻ lắm, lên xe đi'],
      nameCall: ['Ơi, chú đây. Đi đâu con?', 'Gọi chú hả? Cần xe thì lên đi'],
      insult: ['Ăn nói cho lịch sự, không tui báo công an đó', 'Con nít bây giờ ăn nói ghê quá'],
      fallback: ['Hả con? Chú nghe không rõ', 'Đi đâu thì nói chú chở cho'],
      // Phase C: tiered talk lines (friend = 3-7 talks, close = 8+),
      // time-of-day greetings, and accident reactions. NO economy
      // effects — tiers only change what the NPC says.
      friendLines: ['Con hay đi ngang đây, chú nhớ rồi', 'Gặp con hoài, quen mặt rồi đó'],
      closeLines: ['Con như con cháu trong nhà rồi, đi đâu chú chở', 'Chú chạy xe ngang đây mấy chục năm, gặp con là vui'],
      timeLines: {
        morning: 'Sáng rồi con, đi làm sớm đi',
        noon: 'Trưa nắng, kiếm chỗ mát mà nghỉ con ơi',
        evening: 'Chiều mát rồi, đi dạo thì cẩn thận xe',
        night: 'Tối rồi, về nhà sớm đi con'
      },
      reactLines: ['Trời ơi, đâm xe rồi! Gọi cấp cứu mau!', 'Chỗ này xe chạy nhanh lắm, cẩn thận con ơi']
    },
    {
      id: 'cong', name: 'Anh Công', avatar: 'police', color: '#2c3e50',
      callNames: ['anh cong', 'cong oi'],
      lines: [
        'Đi đứng cẩn thận, đừng chạy nhanh trong phố',
        'Có gì lạ thì báo tui',
        'Tối rồi, đừng tụ tập đông'
      ],
      greet: ['Chào. Đi đứng cẩn thận nha', 'Ờ, chào'],
      howAreYou: ['Vẫn tuần tra bình thường', 'Ổn. Khu này dạo này yên rồi'],
      price: ['Tui không bán gì đâu, cần giúp thì nói', 'Hỏi giá thì ra chợ, tui chỉ tuần tra thôi'],
      nameCall: ['Gì đó? Có chuyện gì thì báo', 'Tui đây. Cần giúp gì?'],
      insult: ['Ăn nói cẩn thận, đừng để tui nhắc lần hai', 'Nói năng cho đàng hoàng'],
      fallback: ['Nói rõ ra, tui đang tuần tra', 'Có gì lạ thì báo tui'],
      // Phase C: tiered talk lines (friend = 3-7 talks, close = 8+),
      // time-of-day greetings, and accident reactions. NO economy
      // effects — tiers only change what the NPC says.
      friendLines: ['Dạo này thấy anh hay qua khu này, quen mặt rồi', 'Anh là dân khu này rồi đó, có gì lạ thì báo tui'],
      closeLines: ['Anh em mình quen nhau rồi, khu này có tui lo', 'Cứ yên tâm, có chuyện gì cứ tìm tui'],
      timeLines: {
        morning: 'Sáng rồi, đi làm cẩn thận nha',
        noon: 'Trưa nắng, đừng chạy xe nhanh',
        evening: 'Chiều rồi, đường đông, đi chậm thôi',
        night: 'Tối rồi, đừng tụ tập khuya quá'
      },
      reactLines: ['Tai nạn! Mọi người tránh ra, để tui xử lý!', 'Đứng lại xem gì, tránh đường cho xe cấp cứu!']
    },
    {
      id: 'ty', name: 'Tý', avatar: 'thug', color: '#c0392b',
      callNames: ['ty oi', 'ty dau gau'],
      lines: [
        'Ê, nhìn gì mà nhìn?',
        'Mày mới tới khu này hả?',
        'Đừng có láo với tao nha'
      ],
      greet: ['Ê, chào mày', 'Gì? Mày gọi tao hả?'],
      howAreYou: ['Khỏe, mày hỏi làm gì?', 'Tao đang chán đây, có gì vui không?'],
      price: ['Mua gì thì ra chợ, hỏi tao làm gì', 'Tiền thì không có, hỏi giá làm gì'],
      nameCall: ['Gì? Tao đây, nói đi', 'Ê, gọi tao có chuyện gì?'],
      insult: ['Mày nói ai đó? Ngon thì ra đây!', 'Mày thích gây sự hả?'],
      fallback: ['Nói gì? Nói lại coi', 'Hả? Mày nói với tao đó hả?'],
      // Phase C: tiered talk lines (friend = 3-7 talks, close = 8+),
      // time-of-day greetings, and accident reactions. NO economy
      // effects — tiers only change what the NPC says.
      friendLines: ['Mày hay lảng vảng đây, tao nhớ mặt mày rồi', 'Ê, dạo này mày quen mặt rồi đó'],
      closeLines: ['Mày là bạn tao rồi đó, ai bắt nạt mày thì nói tao', 'Khu này có tao, mày cứ đi thoải mái'],
      timeLines: {
        morning: 'Sáng rồi, dậy sớm vậy?',
        noon: 'Trưa nắng chang chang, kiếm chỗ mát đi',
        evening: 'Chiều rồi, ra đường chơi không?',
        night: 'Tối rồi, đừng đi lung tung một mình'
      },
      reactLines: ['Ê, tai nạn kìa! Ghê quá!', 'Xe đâm người rồi, tránh ra coi!']
    },
    {
      id: 'mai', name: 'Bé Mai', avatar: 'student', color: '#9b59b6',
      callNames: ['mai oi', 'be mai', 'em mai'],
      lines: [
        'Anh làm nghề gì vậy?',
        'Ở đây có chỗ nào ăn ngon không?',
        'Em mới chuyển tới, chưa quen ai hết'
      ],
      greet: ['Chào bạn! Bạn cũng mới tới hả?', 'Hi! Mình là Mai, bạn tên gì?'],
      howAreYou: ['Em khỏe, đang đi dạo quanh khu này', 'Em hơi đói, chưa biết ăn gì'],
      price: ['Bánh mì 15k đó, chị Lan bán ngon lắm', 'Em cũng không rành giá lắm'],
      nameCall: ['Dạ, em đây! Có gì không ạ?', 'Ơi, bạn gọi mình hả?'],
      insult: ['Ơ kìa, sao bạn nói vậy...', 'Bạn nói vậy mình buồn đó'],
      fallback: ['Hả? Bạn nói gì mình chưa hiểu', 'Ủa, là sao ạ?'],
      // Phase C: tiered talk lines (friend = 3-7 talks, close = 8+),
      // time-of-day greetings, and accident reactions. NO economy
      // effects — tiers only change what the NPC says.
      friendLines: ['Bạn hay đi ngang đây, mình nhớ bạn rồi nè!', 'Gặp bạn hoài, quen rồi đó!'],
      closeLines: ['Bạn là bạn thân của mình rồi đó!', 'Mình quý bạn lắm, có gì kể mình nghe nha!'],
      timeLines: {
        morning: 'Chào buổi sáng! Hôm nay trời đẹp quá!',
        noon: 'Trưa rồi, bạn ăn gì chưa?',
        evening: 'Chiều rồi, đi dạo mát quá!',
        night: 'Tối rồi, bạn về nhà sớm nha!'
      },
      reactLines: ['Á, tai nạn kìa! Sợ quá!', 'Có người bị xe đâm! Gọi người lớn giúp đi!']
    }
  ];

  function findPersona(personaId) {
    for (var i = 0; i < PERSONAS.length; i++) {
      if (PERSONAS[i].id === personaId) return PERSONAS[i];
    }
    return PERSONAS[0];
  }

  function createBotState(personaId) {
    return {
      personaId: personaId,
      lastSpokeAt: 0,
      lastLine: null,
      memory: { playerName: null, until: 0 }
    };
  }

  // Phase C (2026-11-28): PLAYER MEMORY — tiers by talk count with one
  // player (room session, in-memory on the server; the offline client
  // keeps its own counts). 0-2 talks = stranger (tier 0), 3-7 =
  // acquaintance (tier 1), 8+ = friend (tier 2). NO economy effects
  // (no discounts, no gifts) — tiers only change the talk lines.
  var TALK_TIER_NAMES = ['Người lạ', 'Quen biết', 'Bạn bè'];
  function talkTier(count) {
    var n = count || 0;
    if (n >= 8) return 2;
    if (n >= 3) return 1;
    return 0;
  }
  function talkTierName(tier) {
    return TALK_TIER_NAMES[tier] || TALK_TIER_NAMES[0];
  }

  // Time-of-day bucket from the game clock (worldTime, minutes 0..1440):
  // morning 06:00-11:00, noon 11:00-13:00, evening 13:00-18:00,
  // night 18:00-06:00. Talk lines vary by bucket (greetings).
  function timePeriod(worldTime) {
    var h = Math.floor(((worldTime || 0) % 1440) / 60);
    if (h >= 6 && h < 11) return 'morning';
    if (h >= 11 && h < 13) return 'noon';
    if (h >= 13 && h < 18) return 'evening';
    return 'night';
  }

  // Random pick with a seedable rnd (Math.random by default) so tests can
  // force a branch deterministically.
  function pickR(arr, avoid, rnd) {
    if (!arr || !arr.length) return null;
    var pool = arr.filter(function (l) { return l !== avoid; });
    if (!pool.length) pool = arr;
    var r = rnd || Math.random;
    return pool[Math.floor(r() * pool.length)];
  }

  // Tiered + time-of-day talk line for an NPC talk (Phase C). ~30% of the
  // time the NPC greets for the time of day; otherwise the tier pool:
  // tier 2 -> closeLines, tier 1 -> friendLines, tier 0 -> lines.
  function pickTalkLine(persona, tier, period, avoid, rnd) {
    var r = rnd || Math.random;
    if (persona.timeLines && persona.timeLines[period] && r() < 0.3) {
      return persona.timeLines[period];
    }
    var pool = tier === 2 && persona.closeLines ? persona.closeLines
      : tier === 1 && persona.friendLines ? persona.friendLines
      : persona.lines;
    return pickR(pool, avoid, r);
  }

  // Short reaction line when an accident happens nearby (Phase C).
  function pickReactLine(persona, avoid, rnd) {
    if (persona.reactLines && persona.reactLines.length) {
      return pickR(persona.reactLines, avoid, rnd);
    }
    return pick(persona.lines, avoid);
  }

  // Insult detection: match whole WORDS only ("người" must not match "ngu").
  var INSULT_WORDS = ['dm', 'dmm', 'dcm', 'dkm', 'ngu', 'cut',
    'do cho', 'do lon', 'mat day', 'khon nan', 'deo', 'cmm', 'clm', 'vcl'];
  var INSULT_WITH_MAY = ['ngu', 'dot', 'cho', 'lon', 'cut', 'chet', 'khon', 'deo', 'dien', 'dang ghet'];
  function wordsOf(norm) {
    return norm.trim().split(/\s+/).filter(function (w) { return w; });
  }
  function isInsult(norm) {
    var words = wordsOf(norm);
    var padded = ' ' + words.join(' ') + ' ';
    for (var i = 0; i < INSULT_WORDS.length; i++) {
      if (padded.indexOf(' ' + INSULT_WORDS[i] + ' ') !== -1) return true;
    }
    if (words.indexOf('may') !== -1) {
      for (var j = 0; j < INSULT_WITH_MAY.length; j++) {
        if (words.indexOf(INSULT_WITH_MAY[j]) !== -1) return true;
      }
    }
    return false;
  }

  function containsAny(norm, words) {
    for (var i = 0; i < words.length; i++) {
      if (norm.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function respond(personaId, text, playerName, state) {
    var persona = findPersona(personaId);
    state = state || createBotState(personaId);
    var norm = ' ' + stripDiacritics(text).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
    var line = null;

    // Remember the player's name for 5 minutes (SRS §10.3).
    if (playerName) {
      state.memory = { playerName: playerName, until: Date.now() + 5 * 60 * 1000 };
    }

    if (isInsult(norm)) {
      line = pick(persona.insult, state.lastLine);
    } else if (containsAny(norm, persona.callNames)) {
      line = pick(persona.nameCall, state.lastLine);
    } else if (containsAny(norm, [' chao ', ' hello ', ' hi ', ' hey ', ' e ', ' alo '])) {
      line = pick(persona.greet, state.lastLine);
      // Greet back using the remembered name on the next reply, not the first.
      if (state.memory.playerName && Date.now() < state.memory.until && Math.random() < 0.5) {
        line = line.replace(/^Ờ, chào/, 'Ờ, chào ' + state.memory.playerName)
                   .replace(/^Chào,/, 'Chào ' + state.memory.playerName + ',')
                   .replace(/^Chào /, 'Chào ' + state.memory.playerName + ', ')
                   .replace(/^Ê, chào mày/, 'Ê, chào ' + state.memory.playerName);
      }
    } else if (containsAny(norm, ['khoe khong', 'khoe ko', 'dang lam gi', 'an chua', 'lam gi do', 'co khoe khong'])) {
      line = pick(persona.howAreYou, state.lastLine);
    } else if (containsAny(norm, ['bao nhieu', 'gia bao nhieu', ' mua ', 'banh mi', 'dat ship', 'gia ca'])) {
      line = pick(persona.price, state.lastLine);
    } else {
      // No trigger: stay silent ~25% of the time, else a generic persona line.
      if (Math.random() < 0.25) return null;
      line = pick(persona.fallback, state.lastLine);
    }

    state.lastLine = line;
    state.lastSpokeAt = Date.now();
    return line;
  }

  return {
    PERSONAS: PERSONAS,
    createBotState: createBotState,
    respond: respond,
    stripDiacritics: stripDiacritics,
    // Phase C: player memory tiers + time-of-day talk + reactions.
    TALK_TIER_NAMES: TALK_TIER_NAMES,
    talkTier: talkTier,
    talkTierName: talkTierName,
    timePeriod: timePeriod,
    pickTalkLine: pickTalkLine,
    pickReactLine: pickReactLine
  };
});
