# Getting Millie Time online

Two parts: put the code on GitHub (private), then point Cloudflare Pages at it.
About ten minutes, once.

---

## 1 · GitHub

The repo is already initialised and committed locally. You just need somewhere to
push it. There's no `gh` CLI on this machine, so the repo gets created in the browser.

1. Go to **https://github.com/new**
2. Repository name: `millie-time`
3. **Private** — this matters. The code carries her name and your words.
4. Leave *Add a README*, *.gitignore* and *license* **unchecked** — this repo already
   has all three and a pre-filled repo makes the first push conflict.
5. **Create repository**

Then, in `G:\Claude`:

```bash
git remote add origin https://github.com/YOUR-USERNAME/millie-time.git
```

```bash
git push -u origin main
```

If it asks for credentials, use a personal access token as the password
(**Settings → Developer settings → Personal access tokens → Tokens (classic)**,
scope `repo`). Windows will remember it after the first time.

---

## 2 · Cloudflare Pages

1. **https://dash.cloudflare.com** → sign up or log in (free, no card).
2. **Compute (Workers & Pages)** → **Create** → **Pages** tab → **Connect to Git**.
3. Authorise Cloudflare for GitHub. When it asks which repositories, pick
   **Only select repositories** → `millie-time`. Don't grant it everything.
4. Select the repo → **Begin setup**.
5. Build settings — this is the only screen where a wrong answer costs you time:

   | Field | Value |
   |---|---|
   | Framework preset | **None** |
   | Build command | *(leave completely empty)* |
   | Build output directory | **`public`** |
   | Root directory | *(leave empty)* |

   There is no build step. If you give it one it will fail, because there's nothing
   to build — that's the point of the stack.

6. **Save and Deploy.** First deploy takes under a minute.
7. You get a URL like **`https://millie-time.pages.dev`**. That's the app.

### Confirm the headers landed

The `_headers` file is what guarantees updates reach her phone. Check it took effect:

```bash
curl -sI https://millie-time.pages.dev/sw.js | grep -i cache-control
```

You want `cache-control: no-cache`. If you see anything else, the `_headers` file
isn't at the root of the output directory — check that **Build output directory**
really is `public`.

---

## 3 · Onto the phone

**Yours first.** Do the whole §6.4 test pass in `PLAN.md` before she ever sees it.

1. Open the URL in **Safari** (not Chrome — the install flow is most reliable there).
2. Share button → **Add to Home Screen** → **Add**.
3. Launch it from the icon, not from a tab. Everything depends on this: the
   standalone chrome, the splash, and the storage exemption that stops iOS purging
   her captions between weeks.

If anything misbehaves on device, open `https://millie-time.pages.dev/#debug`,
tap **Copy diagnostics**, and paste the result back to me. That screen exists
because Safari's remote inspector needs a Mac and you're on Windows — it is the
only console you'll get.

**Then hers.** Do the install yourself if you can. It's the one step where a
misfire — added from Chrome, or left as a bookmark — quietly degrades everything.

---

## 4 · Pushing an update later

```bash
git add -A && git commit -m "what changed" && git push
```

Live in about thirty seconds. Two things to remember:

- Bump `CACHE_VERSION` in `public/sw.js` **and** `version` in `public/js/config.js`
  on any release. The service worker serves cached files; without the bump the old
  ones stay put.
- It applies on her **next cold launch**. iOS kills backgrounded PWAs freely, so
  that's usually the same day. To force it: three taps on the version stamp in the
  footer clears every cache and hard-reloads.

### ⚠️ Changing the icon is different

Everything else updates on her next cold launch. The icon does not. **iOS
snapshots the home-screen icon when the app is added and never re-reads it** —
no redeploy, cache header or version bump will change it.

To pick up a new icon, the shortcut has to be deleted and re-added from Safari.
That also clears the app's storage, so any autosaved captions go with it.

Practical consequence: **settle the icon before she installs it.** Changing it
afterwards means asking her to delete and re-add the app.

### Testing a risky change without touching her copy

```bash
git checkout -b try-something
```

Push that branch and Cloudflare builds it at its own preview URL. Test it on your
iPhone, and only merge to `main` when you're happy. Her home-screen icon never
points at anything you haven't seen working.

---

## Changing the personal bits

Everything you'd want to reword lives in **`public/js/config.js`** — the tagline,
the typeface it uses, the word after a successful send, the heading on the print,
the length of the week. No logic in that file; edit, commit, push.

Fonts are self-hosted in `public/fonts/` so the app works with no signal. To make
another face selectable, drop the `.woff2` in there, add an `@font-face` and a
`.font-yourname` rule in `app.css`, add it to the `SHELL` list in `sw.js`, and set
`taglineFont`.
