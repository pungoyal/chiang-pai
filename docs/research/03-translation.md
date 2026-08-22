# Real-time two-way speech interpretation for travellers (August 2026)

## 1. Incumbents

**Google Translate.** The free app's Conversation tab was rebuilt on 9 June 2026 around *Gemini 3.5 Live Translate*: audio-to-audio (no STT→MT→TTS chain), auto-detects 70+ languages, switches output language by who is speaking, keeps the speaker's pacing and pitch, "a few seconds behind". Global rollout, free. Hindi supported; Thai and Vietnamese in the selector; Indonesian "expanding". Offline packs (59 languages incl. Thai, Vietnamese, Hindi, Indonesian) use the legacy pipeline, not the Gemini voice mode. Lens camera translation is free and covers the target languages.

**Apple.** Translate app: 18 languages incl. Thai, Vietnamese, Indonesian — **no Hindi**. iOS 26 Live Translation with AirPods: EN/FR/DE/PT/ES (+ ZH/IT/JA/KO in 26.2) — **no Thai, Vietnamese, Hindi, Indonesian**. Tests: waits for sentence end, "slower and more tiring", accuracy drops sharply above ~70 dB ambient.

**Samsung Galaxy AI Interpreter.** Free on S24/S25/S26 and recent folds; split-screen; ~20 languages incl. **Thai, Vietnamese, Hindi, Indonesian**; downloadable packs give real offline for common pairs. The strongest free offline option for this language set — Samsung-only.

**Others.** Microsoft Translator retired its multi-device Converse feature 30 June 2026. **SayHi** (Amazon) shut 5 Aug 2024. **iTranslate** is a paywall play ($9.99/week). **Papago** free, 14 languages, strongest for Korean/Japanese, shallower Thai.

**Hardware.** Timekettle W4 Pro $449 (offline only for EN/ZH/JA/KO/FR/ES/DE/RU pairs — Thai/Vietnamese not offline); Fluentalk T1 $299; Vasco V4 ~$389; Pocketalk S2 $150–300. Devices exist for people who cannot or will not use a phone.

**Net:** two-way voice in Thai/Vietnamese/Hindi/Indonesian is free and good in Google Translate (online) and Samsung (partly offline); Apple is absent on these languages in the earbud path; paid apps and hardware are residual.

## 2. Web platform reality

- **iOS Safari `webkitSpeechRecognition`**: exists since 14.5, routes through Apple's recogniser (covers Thai, Vietnamese, Hindi, Indonesian). Known defects through iOS 17/18/26: `continuous=true` never ends and drops results, `interimResults` inconsistent, and **it does not work in a Home Screen (standalone) web app**. Chrome/Edge on iOS inherit this. Usable only as tap-to-talk in a real Safari tab — exactly what `/talk` does.
- **Android Chrome**: cloud recogniser, broad languages, stable `continuous`. Chrome 139 shipped on-device `processLocally`; Thai pack coverage unconfirmed.
- **`speechSynthesis`**: iOS exposes only pre-installed voices (Thai/Vietnamese/Hindi compact voices ship). Android Chrome silently falls back to English if the Google TTS pack isn't downloaded — check `voice.lang` actually resolved; keep the `SPEECH_BASE_URL` fallback.
- **PWA continuous listening**: not on iOS. **New APIs**: Chrome built-in Translator/LanguageDetector are desktop only; WebGPU Whisper runs in-browser but is multi-second per utterance and a 100–500 MB download; Apple's SpeechAnalyzer is native only.

## 3. Server-side options and cost (per minute of audio, list)

| Layer | Option | Languages | ~$/min |
|---|---|---|---|
| STT | Deepgram Nova-3 | Thai/Vi/Hi/Id streaming | $0.0077 |
| STT | AssemblyAI Universal-Streaming | multilingual streaming limited; others batch | ~$0.006 |
| STT | OpenAI gpt-4o-transcribe / realtime | broad | $0.006 / $0.017 |
| STT | ElevenLabs Scribe v2 Realtime | 90+, 150 ms | $0.0065 |
| STT | Sarvam (Indic) | 22 Indian languages | ~$0.006 |
| TTS | Google WaveNet / Neural2 / Chirp 3 HD | Thai, Vi, Hi, Id | $4 / $16 / $30 per M chars |
| TTS | OpenAI gpt-4o-mini-tts | broad | ~$16/M chars |
| TTS | Cartesia Sonic 3 | 42 langs incl. Thai/Vi/Hi | ~$37/M chars |
| TTS | MiniMax speech-2.6 | 40 langs, cross-lingual voices | $60–100/M chars |
| TTS | ElevenLabs Flash/Multilingual | yes | $50–100/M chars |
| S2S | Gemini 3.5 Live Translate API | 70+ | free in preview; ≈ $0.037/min each direction after |
| S2S | OpenAI gpt-realtime-2.1 / mini | broad | $0.019 in + $0.077 out; mini ≈ ⅓ |

A spoken turn is ~150 characters: TTS $0.001–0.015 per turn; a DIY pipeline ~$0.02–0.04 per spoken minute; S2S $0.04–0.10. For one friend group on a two-week trip this is cents. Cost is not the constraint; latency and robustness are.

## 4. Differentiator or commodity?

Commodity. Google Translate has >1B monthly users and conversation mode in 70 languages; every flagship phone bundles a free interpreter. The specialist tier is consolidating. Consistent pain points: **noise** (markets, restaurants), **latency/turn-taking** (systems wait for sentence end), **register** (Thai ครับ/ค่ะ, Hindi tu/tum/aap guessed rather than known), **domain** (prices, numbers, dish names), and most tourist needs are **reading** (menus, signs, receipts) where camera beats speech.

## 5. Adjacent "talk to locals" features that matter more for a group

- **Address card in local script** (hotel, tonight's restaurant) to show a driver — used more than any spoken sentence.
- **Phrase cards the group wrote together** — "we are 8, one vegetarian, no coriander", "meter please", with the gender toggle baked in. This is exactly what the kept `phrases` already are.
- **Haggle helper**: target price, walk-away price, the number spoken aloud in Thai with the right particle.
- **Menu OCR**: commodity via Lens; the group version is "what did we order, who owes what", which is the bill.
- **Currency converter** defaulting to the trip's destination.

## Implications for Chiang Pai

1. **Do not compete with Google on interpretation.** Keep `/talk` as a thin tap-to-talk that works in Safari today; spend no more on STT/TTS plumbing.
2. **The thin slice that beats Google is everything Google does not know about the group**: the shared phrasebook (voice and particle already chosen), address/destination cards, a haggle/number-speaker tied to the bill's currency, and the bill itself. Google is per-person; the group's phrases, places, and money are the moat.
3. If a server voice is kept, Cartesia/Google Chirp are cheaper than MiniMax for Thai; at these volumes it is irrelevant. Gemini Live Translate API is the only audio-to-audio option covering the four languages if S2S ever comes back.
4. Guard the existing constraints: politeness toggle (Google guesses gender, Chiang Pai asks), no stored turns, `voiceFor` refusal for a language the pair no longer covers.

Sources: Google blog (Gemini 3.5 Live Translate, 9 Jun 2026); Apple Translate App Store listing and iOS 26.2 support note; Samsung Galaxy AI language guide; WhistleOut (Microsoft Translator, iTranslate); Lemmy thread on SayHi shutdown; Apple developer forums on webkitSpeechRecognition in standalone mode; Chrome 139 release notes; Chrome Translator API docs; WWDC25 SpeechAnalyzer; vendor pricing pages (Deepgram, AssemblyAI, ElevenLabs, Sarvam, Cartesia, MiniMax, OpenAI); CloudPrice for Gemini Live Translate; Boostlingo/SAN AirPods tests.
