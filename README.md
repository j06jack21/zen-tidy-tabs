# Zen Tidy Tabs

Arc's **Tidy Tabs** for Zen Browser. One click (or a shortcut) groups your loose tabs by topic into Zen folders, named by an AI. Works on macOS, Windows and Linux.

- **Tidy** button appears on the divider above your tabs, next to Zen's *Clear* button (hover the divider to see it).
- Shortcut: `Alt+Shift+T` (`Option+Shift+T` on macOS), configurable.
- **Undo** for 10 seconds after each tidy (click the button again or press the shortcut).
- Reuses your existing folders when a tab fits one.
- Optional auto-tidy when loose tabs pile up.

## Modes

| Mode | What happens |
|---|---|
| `folders` (default) | Each topic becomes a Zen folder. Zen folders live in the pinned section, so those tabs become pinned. |
| `sort` | Tabs stay unpinned; they are just reordered so each topic sits together. |

## AI providers

| Provider | Cost | Setup |
|---|---|---|
| Ollama | Free, local, private | Install Ollama, run `ollama pull llama3.2` |
| Gemini | Paid API, free tier available | API key from Google AI Studio |
| Claude | Paid API | API key from console.anthropic.com |
| OpenAI-compatible | Varies | Base URL + model (OpenAI, OpenRouter, Groq, LM Studio, llama.cpp…) |
| Domain | Free, no AI | Groups by website |

Only tab titles and hostnames are sent to the model.

## Install

1. **Install Sine** (Zen mod manager): download the installer for your OS from the Sine GitHub releases (`CosmoCreeper/Sine`), run it, restart Zen.
2. In Zen go to **Settings → Sine Mods**, open Sine's settings and turn on **installing JS from unofficial sources**.
3. Push this folder to a GitHub repo, then paste `your-username/zen-tidy-tabs` into the box under the Sine marketplace and install.
4. Restart Zen. If the button doesn't show up: `about:support` → **Clear startup cache** → restart.
5. Open the mod's settings in Sine and choose a provider.

### Ollama per OS

- **macOS:** `brew install ollama && brew services start ollama` (or the app from ollama.com)
- **Windows:** installer from ollama.com (runs in the tray)
- **Arch:** `sudo pacman -S ollama` (or `ollama-cuda` / `ollama-rocm`), then `sudo systemctl enable --now ollama`

Then: `ollama pull llama3.2`. A bigger model (e.g. `qwen2.5:7b`) names groups better if your machine can run it.

## Preferences (`about:config`, all under `tidy-tabs.`)

`provider`, `mode`, `min-group-size`, `reuse-existing-folders`, `collapse-new-folders`, `fallback-to-domain`, `custom-instructions`, `shortcut`, `auto-tidy`, `auto-threshold`, `ollama.url`, `ollama.model`, `gemini.key`, `gemini.model`, `anthropic.key`, `anthropic.model`, `openai.url`, `openai.key`, `openai.model`.

API keys are stored as plain prefs in your Zen profile, so don't sync that profile anywhere public.

## Troubleshooting

- **Button says "Tidy failed":** hover it for the error. Full logs: `Ctrl/Cmd+Shift+J` (Browser Console), filter `Tidy Tabs`.
- **Ollama 403:** start Ollama with `OLLAMA_ORIGINS="*"`.
- **Nothing happens:** Tidy needs at least 2 loose tabs. New-tab/blank pages are ignored.
- From the Browser Console: `ZenTidyTabs.tidy()` / `ZenTidyTabs.undo()`.
