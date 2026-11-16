# Fishing Log

Рибальські снасті: що є й де лежить. PWA без збирання — ванільний JS, IndexedDB, офлайн через service worker.

- **Місця** вкладаються одне в одне: «Гараж → Шафа → Ящик Plano №2». QR-наклейка на ящику відкриває його вміст.
- **Снасті**: вудилища, котушки, шнури — поштучно; приманки й оснастка — кількістю. Котушка ставиться на вудилище, шнур — на котушку.
- **Фото** речі: «Знайти фото» в Google Картинках, «Вставити» або «Поділитися» → Fishing Log.
- **Хочу купити**, Google Диск, резервна копія, українська й російська.

Специфікація — [SPEC.md](SPEC.md). Каркас — з [fpv-log](https://github.com/VitaliyLobko/fpv-log).

Локально: `python -m http.server` у корені й відкрити `http://localhost:8000` (service worker на localhost вимкнено, офлайн — з `?sw`).

<!-- demo-photos -->
## Фото в демоданих

Фото приманок, котушки й щуки в `demo.json` — з Wikimedia Commons за вільними ліцензіями; частину кадровано. Назви моделей і кольорів у демо — для прикладу, на фото не обовʼязково саме ця модель.

- [Angeln zubehoer wobbler 01.jpg](https://commons.wikimedia.org/wiki/File:Angeln_zubehoer_wobbler_01.jpg) — User:Raboe001, CC BY-SA 2.5
- [DAIWA AYUING.jpg](https://commons.wikimedia.org/wiki/File:DAIWA_AYUING.jpg) — Indiana jo, CC BY-SA 4.0
- [Ein Wobbler aus Gummi.jpg](https://commons.wikimedia.org/wiki/File:Ein_Wobbler_aus_Gummi.jpg) — Danndorfer1914, CC0
- [Verschiedene Crankbaits.jpg](https://commons.wikimedia.org/wiki/File:Verschiedene_Crankbaits.jpg) — Danndorfer1914, CC0
- [Wobbler 2008 G1.jpg](https://commons.wikimedia.org/wiki/File:Wobbler_2008_G1.jpg) — George Chernilevsky, Public domain
- [Verschiedene Wobbler.jpg](https://commons.wikimedia.org/wiki/File:Verschiedene_Wobbler.jpg) — Danndorfer1914, CC0
- [Zwei Wobbler für das Angeln an der Oberfläche.jpg](https://commons.wikimedia.org/wiki/File:Zwei_Wobbler_f%C3%BCr_das_Angeln_an_der_Oberfl%C3%A4che.jpg) — Danndorfer1914, CC0
- [Spinner lure no feather ora.png](https://commons.wikimedia.org/wiki/File:Spinner_lure_no_feather_ora.png) — Jeremykemp at English Wikipedia, Public domain
- [Moderne Spinner.jpg](https://commons.wikimedia.org/wiki/File:Moderne_Spinner.jpg) — Danndorfer1914, CC0
- [Cucchiaino.jpg](https://commons.wikimedia.org/wiki/File:Cucchiaino.jpg) — Cemg, CC BY-SA 3.0
- [Ein goldener Blinker.jpg](https://commons.wikimedia.org/wiki/File:Ein_goldener_Blinker.jpg) — Danndorfer1914, CC0
- [Schmale und längliche Blinker.jpg](https://commons.wikimedia.org/wiki/File:Schmale_und_l%C3%A4ngliche_Blinker.jpg) — Danndorfer1914, CC0
- [Mehrere Gummifische in Unterschiedlichen Größen, Farben und Formen.jpg](https://commons.wikimedia.org/wiki/File:Mehrere_Gummifische_in_Unterschiedlichen_Gr%C3%B6%C3%9Fen,_Farben_und_Formen.jpg) — Danndorfer1914, CC0
- [Zwei Twister.jpg](https://commons.wikimedia.org/wiki/File:Zwei_Twister.jpg) — Danndorfer1914, CC0
- [Jig-Twister lure 2009 G1.jpg](https://commons.wikimedia.org/wiki/File:Jig-Twister_lure_2009_G1.jpg) — George Chernilevsky, Public domain
- [Fishing reel 2025 G1.jpg](https://commons.wikimedia.org/wiki/File:Fishing_reel_2025_G1.jpg) — George Chernilevsky, CC BY 4.0
- [Gaddan fran.jpg](https://commons.wikimedia.org/wiki/File:Gaddan_fran.jpg) — Creator: Victor Hörnqvist, eget taget foto., CC0
<!-- /demo-photos -->
