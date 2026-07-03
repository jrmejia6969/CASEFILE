import React, { useState, useRef, useCallback } from "react";

/* ---------- design tokens ----------
bg:      #12151a
surface: #1b1f26
line:    #2a2f38
ink:     #eef0f2
mute:    #8b93a1
brand:   #6e8fd1  (investigation blue)
safe:    #4f9d84
warn:    #e0a458
danger:  #d1495b
--------------------------------------- */

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;900&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
`;

// ---------- image hashing (client-side dHash, 9x8 -> 64 bit) ----------
function computeDHash(img) {
  const w = 9, h = 8;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  let bits = "";
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w - 1; col++) {
      const left = gray[row * w + col];
      const right = gray[row * w + col + 1];
      bits += left > right ? "1" : "0";
    }
  }
  // 64 bits -> hex
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

function hammingDistanceHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

// ---------- lightweight EXIF check (JPEG only) ----------
// This is a WEAK signal, not proof: real camera photos usually carry EXIF
// (make/model/date). Screenshots, re-saved images, and most AI-generated or
// heavily edited photos typically have it stripped or absent. Presence of
// EXIF is reassuring; absence is NOT proof of anything — plenty of real
// photos get stripped by the platform itself (Instagram, Facebook, etc. all
// strip EXIF on upload), so this only means something when combined with
// other evidence.
function checkExif(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.getUint16(0) !== 0xffd8) return { isJpeg: false, hasExif: false, tags: {} };
  let offset = 2;
  while (offset < view.byteLength - 2) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      // APP1 - check for "Exif" header
      const exifStr = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7)
      );
      if (exifStr === "Exif") {
        const tags = {};
        try {
          const tiffOffset = offset + 10;
          const little = view.getUint16(tiffOffset) === 0x4949;
          const ifdOffset = view.getUint32(tiffOffset + 4, little);
          const entries = view.getUint16(tiffOffset + ifdOffset, little);
          for (let i = 0; i < entries; i++) {
            const entryOffset = tiffOffset + ifdOffset + 2 + i * 12;
            const tag = view.getUint16(entryOffset, little);
            if (tag === 0x010f) tags.make = true; // Make
            if (tag === 0x0110) tags.model = true; // Model
            if (tag === 0x0132) tags.date = true; // DateTime
            if (tag === 0x9003) tags.dateOriginal = true; // DateTimeOriginal
          }
        } catch (e) {
          /* malformed segment, treat as no readable tags */
        }
        return { isJpeg: true, hasExif: true, tags };
      }
    }
    if ((marker & 0xff00) !== 0xff00) break;
    if (marker === 0xffd9 || marker === 0xffda) break;
    offset += 2 + view.getUint16(offset + 2);
  }
  return { isJpeg: true, hasExif: false, tags: {} };
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ img, dataUrl: reader.result });
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- bio red-flag heuristic scorer ----------
const FLAG_CATEGORIES = [
  {
    label: "Isolation / sob story",
    weight: 18,
    phrases: [
      "single mother", "single father", "lives with my mom", "lives with my mother",
      "widow", "widower", "lost my husband", "lost my wife", "raising alone",
      "just joined", "new here", "don't have many friends",
    ],
  },
  {
    label: "Accelerated intimacy",
    weight: 22,
    phrases: [
      "soulmate", "destiny", "god brought us together", "love you already",
      "meant to be", "you're the one", "fell for you", "my king", "my queen",
    ],
  },
  {
    label: "Push off-platform",
    weight: 20,
    phrases: [
      "whatsapp", "telegram", "hangouts", "here's my number", "text me at",
      "add me on", "let's talk outside this app",
    ],
  },
  {
    label: "Money / financial ask",
    weight: 30,
    phrases: [
      "gift card", "wire transfer", "western union", "stuck at customs",
      "hospital bill", "investment opportunity", "crypto wallet", "send money",
      "help me pay", "emergency funds", "bitcoin", "cash app me",
    ],
  },
  {
    label: "Too-good-to-be-true profile",
    weight: 10,
    phrases: [
      "oil rig", "military deployed", "overseas contract", "surgeon",
      "engineer on assignment", "international business", "own a company",
      "widower with", "millionaire",
    ],
  },
  {
    label: "Avoids video / in person",
    weight: 24,
    phrases: [
      "camera's broken", "camera is broken", "webcam isn't working",
      "can't video call", "can't do video", "bad connection for video",
      "phone's not working for video", "maybe another time", "next time we'll video",
      "can't meet right now", "can't meet in person yet",
    ],
  },
  {
    label: "Disappearing / unreachable excuses",
    weight: 16,
    phrases: [
      "lost my phone", "phone got stolen", "traveling for work again",
      "signal is bad where i am", "can't talk for a few days", "going off grid",
      "deployment means i can't call", "no wifi where i'm at",
    ],
  },
];

function scoreBio(text) {
  const lower = text.toLowerCase();
  const hits = [];
  let score = 0;
  FLAG_CATEGORIES.forEach((cat) => {
    const matched = cat.phrases.filter((p) => lower.includes(p));
    if (matched.length) {
      score += cat.weight;
      hits.push({ label: cat.label, matched });
    }
  });
  return { score: Math.min(100, score), hits };
}

const PROFILE_SIGNALS = [
  { key: "newAccount", label: "Account is newly created / \"just joined\"", weight: 12 },
  { key: "fewPhotos", label: "Only one or two photos posted", weight: 14 },
  { key: "noMutuals", label: "No mutual friends or connections", weight: 8 },
  { key: "refusedVideo", label: "Refused or dodged a live video call", weight: 26 },
  { key: "askedMoney", label: "Has asked for money, gift cards, or crypto", weight: 40 },
];

function verdict(combinedScore) {
  if (combinedScore >= 60) return { tag: "HIGH RISK", color: "var(--danger)" };
  if (combinedScore >= 30) return { tag: "CAUTION", color: "var(--warn)" };
  return { tag: "NO FLAGS FOUND", color: "var(--safe)" };
}

// ---------- storage helpers ----------
// NOTE: replace this with your own Firebase Realtime Database URL before
// deploying. Free to create at https://console.firebase.google.com —
// create a project, enable "Realtime Database", start in test mode, and
// copy the URL it gives you (looks like https://YOUR-PROJECT-default-rtdb.firebaseio.com)
const FIREBASE_DB_URL = "https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com";

async function loadDB() {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/reports.json`);
    const data = await res.json();
    return data ? Object.values(data) : [];
  } catch (e) {
    console.error("load failed", e);
    return [];
  }
}

async function saveReport(entry) {
  try {
    await fetch(`${FIREBASE_DB_URL}/reports.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch (e) {
    console.error("save failed", e);
  }
}

export default function App() {
  const [imgData, setImgData] = useState(null); // {img, dataUrl, hash}
  const [scanning, setScanning] = useState(false);
  const [matches, setMatches] = useState(null); // array or null
  const [exifInfo, setExifInfo] = useState(null);
  const [bioText, setBioText] = useState("");
  const [bioResult, setBioResult] = useState(null);
  const [profileFlags, setProfileFlags] = useState({});
  const [reportName, setReportName] = useState("");
  const [reportPlatform, setReportPlatform] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [dbCount, setDbCount] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setScanning(true);
    setMatches(null);
    setExifInfo(null);
    try {
      const { img, dataUrl } = await loadImageFromFile(file);
      const hash = computeDHash(img);
      setImgData({ dataUrl, hash });
      const buffer = await file.arrayBuffer();
      setExifInfo(checkExif(buffer));
      const db = await loadDB();
      setDbCount(db.length);
      const found = db
        .map((entry) => ({ ...entry, distance: hammingDistanceHex(hash, entry.hash) }))
        .filter((entry) => entry.distance <= 10)
        .sort((a, b) => a.distance - b.distance);
      setMatches(found);
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
    }
  }, []);

  const runBioScan = () => {
    if (!bioText.trim()) return;
    setBioResult(scoreBio(bioText));
  };

  const submitReport = async () => {
    if (!imgData || !reportName.trim() || !reportPlatform.trim()) {
      setReportStatus("Add a name/handle and platform before submitting.");
      return;
    }
    setReportStatus("Saving…");
    await saveReport({
      hash: imgData.hash,
      name: reportName.trim(),
      platform: reportPlatform.trim(),
      note: reportNote.trim(),
      ts: Date.now(),
    });
    const db = await loadDB();
    setDbCount(db.length);
    setReportStatus("Added to the shared database. Thanks — this helps the next person.");
    setReportName("");
    setReportPlatform("");
    setReportNote("");
  };

  const photoScore = matches === null ? 0 : matches.length > 0 ? (matches.length > 1 ? 70 : 45) : 0;
  const checklistScore = PROFILE_SIGNALS.reduce(
    (sum, sig) => sum + (profileFlags[sig.key] ? sig.weight : 0),
    0
  );
  const anyChecked = Object.values(profileFlags).some(Boolean);
  const combined = Math.min(
    100,
    photoScore + (bioResult ? bioResult.score * 0.6 : 0) + checklistScore * 0.7
  );
  const v = matches !== null || bioResult || anyChecked ? verdict(combined) : null;

  return (
    <div style={styles.page}>
      <style>{FONTS}</style>
      <style>{cssVars}</style>

      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brandRow}>
            <div style={styles.brandMark}>◈</div>
            <div>
              <div style={styles.brandName}>CASEFILE</div>
              <div style={styles.brandSub}>profile verification desk</div>
            </div>
          </div>
          <div style={styles.dbBadge}>
            {dbCount === null ? "shared database: —" : `shared database: ${dbCount} reported photo${dbCount === 1 ? "" : "s"}`}
          </div>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.hero}>
          <h1 style={styles.h1}>Before you trust the profile, check the evidence.</h1>
          <p style={styles.heroSub}>
            Upload a profile photo to check if it's been used under other names, and paste
            the bio or messages to scan for common scam-script language. Nothing here proves
            guilt — it surfaces evidence so you can judge for yourself.
          </p>
        </div>

        <div style={styles.grid} className="two-col">
          {/* Evidence A: Photo */}
          <section style={styles.card}>
            <div style={styles.cardLabel}>EVIDENCE A — PHOTO</div>
            <div
              style={styles.dropZone}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) handleFile(f);
              }}
            >
              {imgData ? (
                <div style={styles.imgWrap}>
                  <img src={imgData.dataUrl} alt="uploaded" style={styles.imgPreview} />
                  {scanning && <div style={styles.scanLine} />}
                </div>
              ) : (
                <div style={styles.dropPrompt}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>⌁</div>
                  <div>Drop a photo here, or tap to choose one</div>
                  <div style={styles.dropHint}>Processed in your browser — the photo isn't uploaded anywhere.</div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>

            {imgData && (
              <div style={styles.hashRow}>
                <span style={styles.hashLabel}>fingerprint</span>
                <span style={styles.hashValue}>{imgData.hash}</span>
              </div>
            )}

            {exifInfo && (
              <div style={styles.exifRow}>
                {exifInfo.hasExif ? (
                  <span style={{ ...styles.pill, background: "var(--safe-dim)", color: "var(--safe)" }}>
                    Camera metadata present — weak signal this is an original photo
                  </span>
                ) : (
                  <span style={{ ...styles.pill, background: "var(--warn-dim)", color: "var(--warn)" }}>
                    No camera metadata found — could mean screenshot, re-saved, edited, or AI-generated. Also very common for ordinary photos once uploaded to social apps, which strip this automatically. Not proof either way.
                  </span>
                )}
              </div>
            )}

            {matches !== null && !scanning && (
              <div style={styles.resultBlock}>
                {matches.length === 0 ? (
                  <div style={{ ...styles.pill, background: "var(--safe-dim)", color: "var(--safe)" }}>
                    No matches in the shared database yet
                  </div>
                ) : (
                  <>
                    <div style={{ ...styles.pill, background: "var(--danger-dim)", color: "var(--danger)" }}>
                      Matches {matches.length} prior report{matches.length > 1 ? "s" : ""}
                    </div>
                    <ul style={styles.matchList}>
                      {matches.map((m, i) => (
                        <li key={i} style={styles.matchItem}>
                          <span style={styles.matchName}>{m.name}</span>
                          <span style={styles.matchPlatform}>{m.platform}</span>
                          {m.note && <div style={styles.matchNote}>"{m.note}"</div>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>

          {/* Evidence B: Bio */}
          <section style={styles.card}>
            <div style={styles.cardLabel}>EVIDENCE B — BIO / MESSAGES</div>
            <textarea
              style={styles.textarea}
              placeholder="Paste their bio, opening message, or anything that felt off…"
              value={bioText}
              onChange={(e) => setBioText(e.target.value)}
              rows={7}
            />
            <button style={styles.btnSecondary} onClick={runBioScan}>
              Scan text
            </button>

            {bioResult && (
              <div style={styles.resultBlock}>
                {bioResult.hits.length === 0 ? (
                  <div style={{ ...styles.pill, background: "var(--safe-dim)", color: "var(--safe)" }}>
                    No common scam-script patterns found
                  </div>
                ) : (
                  <ul style={styles.flagList}>
                    {bioResult.hits.map((h, i) => (
                      <li key={i} style={styles.flagItem}>
                        <span style={styles.flagDot} />
                        <div>
                          <div style={styles.flagLabel}>{h.label}</div>
                          <div style={styles.flagPhrases}>matched: "{h.matched.join('", "')}"</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Evidence C: manual signals */}
        <section style={{ ...styles.card, marginBottom: 24 }}>
          <div style={styles.cardLabel}>EVIDENCE C — THINGS ONLY YOU'D NOTICE</div>
          <p style={{ ...styles.reportSub, marginBottom: 12 }}>
            These don't show up in a photo hash or bio scan — check anything that's true.
          </p>
          <div style={styles.checklist}>
            {PROFILE_SIGNALS.map((sig) => (
              <label key={sig.key} style={styles.checkItem}>
                <input
                  type="checkbox"
                  checked={!!profileFlags[sig.key]}
                  onChange={(e) =>
                    setProfileFlags((prev) => ({ ...prev, [sig.key]: e.target.checked }))
                  }
                  style={styles.checkbox}
                />
                <span>{sig.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Honest note on AI detection */}
        <section style={{ ...styles.card, marginBottom: 24 }}>
          <div style={styles.cardLabel}>AI-GENERATED PHOTO / VOICE DETECTION</div>
          <p style={{ ...styles.reportSub, marginBottom: 0 }}>
            Not built into this version — and worth being straight about why. Reliable
            deepfake and AI-voice detection runs on trained models hosted on a server; there
            isn't a version of that which honestly runs for free in a browser. Tools that
            claim to do this client-side are usually guessing, and a wrong guess here is worse
            than no answer — it can talk someone into trusting a fake, or doubting someone
            real. The camera-metadata check above is a real, if weak, signal in the meantime.
            A proper version of this feature would plug in a paid detection API (Hive
            Moderation, Reality Defender, and similar exist) behind a real backend — that's a
            phase-2 build, not a client-only one.
          </p>
        </section>

        {/* Verdict */}
        {v && (
          <section style={styles.verdictCard}>
            <div style={styles.stamp(v.color)}>{v.tag}</div>
            <p style={styles.verdictText}>
              This is a summary of the evidence found above, not a determination of guilt.
              Stolen photos and script-like language raise the odds of a scam — they don't
              prove it. When in doubt, ask for a live video call before sending money or
              personal information.
            </p>
          </section>
        )}

        {/* Report / contribute */}
        <section style={styles.reportCard}>
          <div style={styles.cardLabel}>ADD TO THE SHARED DATABASE</div>
          <p style={styles.reportSub}>
            If you've confirmed this photo is being used under a fake identity, add it so the
            next person checking gets a match instantly. This is visible to everyone who uses
            this tool — please only submit what you can back up.
          </p>
          <div style={styles.reportGrid}>
            <input
              style={styles.input}
              placeholder="Name / handle they used"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
            />
            <input
              style={styles.input}
              placeholder="Platform (e.g. Hinge, Instagram)"
              value={reportPlatform}
              onChange={(e) => setReportPlatform(e.target.value)}
            />
          </div>
          <input
            style={{ ...styles.input, width: "100%", marginTop: 10 }}
            placeholder="Optional note (what happened)"
            value={reportNote}
            onChange={(e) => setReportNote(e.target.value)}
          />
          <button style={styles.btnPrimary} onClick={submitReport} disabled={!imgData}>
            {imgData ? "Submit report" : "Upload a photo first"}
          </button>
          {reportStatus && <div style={styles.reportStatus}>{reportStatus}</div>}
        </section>

        <footer style={styles.footer}>
          Reverse web-image search (checking the wider internet, not just this database)
          needs a paid image-search API and a backend — this demo matches against photos
          other users of this tool have reported. Treat every result here as a lead to
          investigate further, not a final answer.
        </footer>
      </main>
    </div>
  );
}

const cssVars = `
:root {
  --safe: #4f9d84;
  --safe-dim: rgba(79,157,132,0.14);
  --warn: #e0a458;
  --warn-dim: rgba(224,164,88,0.14);
  --danger: #d1495b;
  --danger-dim: rgba(209,73,91,0.14);
}
::placeholder { color: #5b6270; }
`;

const styles = {
  page: {
    minHeight: "100vh",
    background: "#12151a",
    color: "#eef0f2",
    fontFamily: "'IBM Plex Sans', sans-serif",
  },
  header: {
    borderBottom: "1px solid #2a2f38",
    position: "sticky",
    top: 0,
    background: "#12151aee",
    backdropFilter: "blur(6px)",
    zIndex: 10,
  },
  headerInner: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "16px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  brandRow: { display: "flex", alignItems: "center", gap: 10 },
  brandMark: { fontSize: 20, color: "#6e8fd1" },
  brandName: {
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 900,
    fontSize: 15,
    letterSpacing: "0.08em",
  },
  brandSub: { fontSize: 11, color: "#8b93a1", letterSpacing: "0.04em" },
  dbBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#8b93a1",
    border: "1px solid #2a2f38",
    borderRadius: 999,
    padding: "5px 12px",
  },
  main: { maxWidth: 880, margin: "0 auto", padding: "40px 20px 80px" },
  hero: { marginBottom: 36 },
  h1: {
    fontFamily: "'Archivo', sans-serif",
    fontWeight: 900,
    fontSize: "clamp(28px, 5vw, 40px)",
    lineHeight: 1.1,
    margin: "0 0 14px",
    letterSpacing: "-0.01em",
  },
  heroSub: { color: "#8b93a1", fontSize: 15, lineHeight: 1.6, maxWidth: 620, margin: 0 },
  grid: {
    display: "grid",
    gap: 20,
    marginBottom: 24,
  },
  card: {
    background: "#1b1f26",
    border: "1px solid #2a2f38",
    borderRadius: 10,
    padding: 20,
  },
  cardLabel: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    letterSpacing: "0.08em",
    color: "#6e8fd1",
    marginBottom: 14,
  },
  dropZone: {
    border: "1.5px dashed #2a2f38",
    borderRadius: 8,
    minHeight: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    overflow: "hidden",
    position: "relative",
  },
  dropPrompt: { textAlign: "center", color: "#8b93a1", fontSize: 13, padding: 20 },
  dropHint: { fontSize: 11, color: "#5b6270", marginTop: 6 },
  imgWrap: { position: "relative", width: "100%" },
  imgPreview: { width: "100%", maxHeight: 280, objectFit: "cover", display: "block" },
  scanLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 2,
    background: "linear-gradient(90deg, transparent, #6e8fd1, transparent)",
    animation: "scan 1.1s linear infinite",
    top: 0,
  },
  hashRow: {
    marginTop: 12,
    display: "flex",
    gap: 8,
    alignItems: "baseline",
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
  },
  hashLabel: { color: "#5b6270" },
  hashValue: { color: "#8b93a1", wordBreak: "break-all" },
  exifRow: { marginTop: 10 },
  resultBlock: { marginTop: 16 },
  pill: {
    display: "inline-block",
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
  },
  matchList: { listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 8 },
  matchItem: {
    border: "1px solid #2a2f38",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 13,
  },
  matchName: { fontWeight: 600, marginRight: 8 },
  matchPlatform: { color: "#8b93a1", fontSize: 12 },
  matchNote: { color: "#8b93a1", fontSize: 12, marginTop: 4, fontStyle: "italic" },
  textarea: {
    width: "100%",
    background: "#12151a",
    border: "1px solid #2a2f38",
    borderRadius: 8,
    color: "#eef0f2",
    padding: 12,
    fontSize: 13,
    fontFamily: "'IBM Plex Sans', sans-serif",
    resize: "vertical",
    boxSizing: "border-box",
  },
  flagList: { listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 },
  flagItem: { display: "flex", gap: 10, alignItems: "flex-start" },
  flagDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#d1495b",
    marginTop: 5,
    flexShrink: 0,
  },
  flagLabel: { fontSize: 13, fontWeight: 600 },
  flagPhrases: { fontSize: 12, color: "#8b93a1", marginTop: 2 },
  verdictCard: {
    background: "#1b1f26",
    border: "1px solid #2a2f38",
    borderRadius: 10,
    padding: "24px 20px",
    marginBottom: 24,
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 12,
  },
  verdictText: { color: "#8b93a1", fontSize: 13, lineHeight: 1.6, margin: 0 },
  reportCard: {
    background: "#1b1f26",
    border: "1px solid #2a2f38",
    borderRadius: 10,
    padding: 20,
  },
  reportSub: { color: "#8b93a1", fontSize: 13, lineHeight: 1.6, margin: "0 0 16px" },
  reportGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  input: {
    background: "#12151a",
    border: "1px solid #2a2f38",
    borderRadius: 8,
    color: "#eef0f2",
    padding: "10px 12px",
    fontSize: 13,
    fontFamily: "'IBM Plex Sans', sans-serif",
    boxSizing: "border-box",
  },
  btnPrimary: {
    marginTop: 14,
    background: "#6e8fd1",
    color: "#12151a",
    border: "none",
    borderRadius: 8,
    padding: "11px 20px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    marginTop: 10,
    background: "transparent",
    color: "#eef0f2",
    border: "1px solid #2a2f38",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  reportStatus: { marginTop: 10, fontSize: 12, color: "#8b93a1" },
  checklist: { display: "grid", gap: 10 },
  checkItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    cursor: "pointer",
    border: "1px solid #2a2f38",
    borderRadius: 8,
    padding: "10px 12px",
  },
  checkbox: { width: 16, height: 16, flexShrink: 0, accentColor: "#6e8fd1" },
  footer: {
    marginTop: 40,
    paddingTop: 20,
    borderTop: "1px solid #2a2f38",
    color: "#5b6270",
    fontSize: 12,
    lineHeight: 1.6,
  },
};

styles.stamp = (color) => ({
  fontFamily: "'Archivo', sans-serif",
  fontWeight: 900,
  fontSize: 20,
  letterSpacing: "0.06em",
  color,
  border: `2px solid ${color}`,
  borderRadius: 6,
  padding: "8px 16px",
  transform: "rotate(-2deg)",
});

const styleSheet = document.createElement("style");
styleSheet.textContent = `
@keyframes scan {
  0% { top: 0; }
  100% { top: 100%; }
}
.two-col { grid-template-columns: 1fr 1fr; }
@media (max-width: 700px) {
  .two-col { grid-template-columns: 1fr !important; }
}
`;
if (typeof document !== "undefined") document.head.appendChild(styleSheet);
