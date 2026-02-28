import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import "./style.css";

const MAX_SLOTS = 50;
const MIN_SLOTS = 1;
const DEFAULT_SLOTS = 3;
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 720;
const MIN_INTRO_SECONDS = 0.1;
const MAX_INTRO_SECONDS = 30;
const DEFAULT_INTRO_SECONDS = 1.0;

const slotCountEl = document.getElementById("slotCount");
const increaseBtn = document.getElementById("increaseBtn");
const decreaseBtn = document.getElementById("decreaseBtn");
const coverImageInput = document.getElementById("coverImage");
const coverSecondsInput = document.getElementById("coverSeconds");
const includeAudioInput = document.getElementById("includeAudio");
const inputsContainer = document.getElementById("inputsContainer");
const mergeForm = document.getElementById("mergeForm");
const mergeBtn = document.getElementById("mergeBtn");
const statusEl = document.getElementById("status");
const downloadLink = document.getElementById("downloadLink");

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let isMerging = false;
let currentSlots = DEFAULT_SLOTS;
let latestBlobUrl = "";

const rows = Array.from({ length: MAX_SLOTS }, (_, index) => {
  const row = document.createElement("div");
  row.className = "input-row";

  const label = document.createElement("label");
  label.setAttribute("for", `video-${index}`);
  label.textContent = `動画 ${index + 1}`;

  const input = document.createElement("input");
  input.type = "file";
  input.id = `video-${index}`;
  input.accept = "video/*";
  input.name = "videos";

  row.append(label, input);
  inputsContainer.appendChild(row);

  return { row, input };
});

function setStatus(text) {
  statusEl.textContent = text;
}

function setLoading(isLoading) {
  mergeBtn.disabled = isLoading;
  coverImageInput.disabled = isLoading;
  coverSecondsInput.disabled = isLoading || !coverImageInput.files?.[0];
  includeAudioInput.disabled = isLoading;
  increaseBtn.disabled = isLoading || currentSlots >= MAX_SLOTS;
  decreaseBtn.disabled = isLoading || currentSlots <= MIN_SLOTS;
}

function updateSlots(nextSlots) {
  currentSlots = nextSlots;
  slotCountEl.textContent = String(currentSlots);

  rows.forEach(({ row, input }, index) => {
    const isVisible = index < currentSlots;
    row.classList.toggle("hidden", !isVisible);
    input.disabled = !isVisible;
    input.required = isVisible;
  });

  increaseBtn.disabled = currentSlots >= MAX_SLOTS;
  decreaseBtn.disabled = currentSlots <= MIN_SLOTS;
}

function clearDownloadLink() {
  if (latestBlobUrl) {
    URL.revokeObjectURL(latestBlobUrl);
    latestBlobUrl = "";
  }
  downloadLink.classList.add("hidden");
  downloadLink.href = "#";
}

function buildFilter({ streamCount, includeAudio, introDuration, hasIntroImage }) {
  const filters = [];

  for (let i = 0; i < streamCount; i += 1) {
    filters.push(
      `[${i}:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}]`
    );
  }

  if (!includeAudio) {
    const concatInputs = Array.from({ length: streamCount }, (_, i) => `[v${i}]`).join("");
    filters.push(`${concatInputs}concat=n=${streamCount}:v=1:a=0[vout]`);
    return filters.join(";");
  }

  const audioLabels = [];
  for (let segment = 0; segment < streamCount; segment += 1) {
    const audioLabel = `a${segment}`;
    const isIntroSegment = hasIntroImage && segment === 0;

    if (isIntroSegment) {
      const seconds = Math.max(MIN_INTRO_SECONDS, introDuration);
      filters.push(
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${seconds},asetpts=N/SR/TB[${audioLabel}]`
      );
    } else {
      const inputIndex = segment;
      filters.push(
        `[${inputIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,aresample=48000,asetpts=PTS-STARTPTS[${audioLabel}]`
      );
    }
    audioLabels.push(audioLabel);
  }

  const concatPairs = [];
  for (let i = 0; i < streamCount; i += 1) {
    concatPairs.push(`[v${i}]`, `[${audioLabels[i]}]`);
  }
  filters.push(`${concatPairs.join("")}concat=n=${streamCount}:v=1:a=1[vout][aout]`);
  return filters.join(";");
}

function normalizeExtension(filename, fallback) {
  const ext = filename.includes(".") ? filename.split(".").pop() : "";
  const normalized = String(ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized.length >= 1 && normalized.length <= 5 ? normalized : fallback;
}

function readIntroSeconds() {
  const value = Number.parseFloat(coverSecondsInput.value);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < MIN_INTRO_SECONDS || value > MAX_INTRO_SECONDS) {
    return null;
  }
  return value;
}

async function ensureFFmpegLoaded() {
  if (ffmpegLoaded) {
    return;
  }

  setStatus("ffmpegを読み込み中...");
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

  ffmpeg.on("progress", ({ progress }) => {
    if (isMerging) {
      const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
      setStatus(`結合中... ${percent}%`);
    }
  });

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
  });

  ffmpegLoaded = true;
}

increaseBtn.addEventListener("click", () => {
  if (currentSlots < MAX_SLOTS) {
    updateSlots(currentSlots + 1);
  }
});

decreaseBtn.addEventListener("click", () => {
  if (currentSlots > MIN_SLOTS) {
    updateSlots(currentSlots - 1);
  }
});

coverImageInput.addEventListener("change", () => {
  setLoading(isMerging);
});

mergeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearDownloadLink();

  const introImageFile = coverImageInput.files?.[0] || null;
  const includeAudio = includeAudioInput.checked;
  let introSeconds = 0;
  if (introImageFile) {
    const parsedSeconds = readIntroSeconds();
    if (parsedSeconds === null) {
      setStatus(`表示秒数は ${MIN_INTRO_SECONDS} 〜 ${MAX_INTRO_SECONDS} 秒で指定してください`);
      return;
    }
    introSeconds = parsedSeconds;
  }

  const selectedFiles = [];
  for (let i = 0; i < currentSlots; i += 1) {
    const file = rows[i].input.files?.[0];
    if (!file) {
      setStatus(`動画 ${i + 1} を選択してください`);
      return;
    }
    selectedFiles.push(file);
  }

  if (selectedFiles.length > MAX_SLOTS) {
    setStatus(`動画は最大 ${MAX_SLOTS} 本までです`);
    return;
  }

  setLoading(true);
  isMerging = true;

  const tempInputNames = [];
  const outputName = `merged-${Date.now()}.mp4`;

  try {
    await ensureFFmpegLoaded();

    const args = [];

    if (introImageFile) {
      const introExt = normalizeExtension(introImageFile.name, "jpg");
      const introInputName = `intro.${introExt}`;
      tempInputNames.push(introInputName);
      await ffmpeg.writeFile(introInputName, await fetchFile(introImageFile));
      args.push("-loop", "1", "-t", String(introSeconds), "-i", introInputName);
    }

    for (let i = 0; i < selectedFiles.length; i += 1) {
      const ext = normalizeExtension(selectedFiles[i].name, "mp4");
      const inputName = `input-${String(i).padStart(2, "0")}.${ext}`;
      tempInputNames.push(inputName);
      await ffmpeg.writeFile(inputName, await fetchFile(selectedFiles[i]));
      args.push("-i", inputName);
    }

    const streamCount = selectedFiles.length + (introImageFile ? 1 : 0);

    args.push(
      "-filter_complex",
      buildFilter({
        streamCount,
        includeAudio,
        introDuration: introSeconds,
        hasIntroImage: Boolean(introImageFile)
      }),
      "-map",
      "[vout]",
      ...(includeAudio ? ["-map", "[aout]"] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      ...(includeAudio ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags",
      "+faststart",
      outputName
    );

    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`);
    }

    const data = await ffmpeg.readFile(outputName);
    const mergedBlob = new Blob([data], { type: "video/mp4" });
    latestBlobUrl = URL.createObjectURL(mergedBlob);

    downloadLink.href = latestBlobUrl;
    downloadLink.download = "merged.mp4";
    downloadLink.classList.remove("hidden");
    setStatus(includeAudio ? "結合完了（音声あり）。ダウンロードできます。" : "結合完了（音声なし）。ダウンロードできます。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "結合に失敗しました";
    if (includeAudio) {
      setStatus(`結合に失敗しました: ${message}。音声なし設定でも試してください。`);
    } else {
      setStatus(`結合に失敗しました: ${message}`);
    }
  } finally {
    for (const name of tempInputNames) {
      try {
        await ffmpeg.deleteFile(name);
      } catch (error) {
        // Ignore delete errors.
      }
    }
    try {
      await ffmpeg.deleteFile(outputName);
    } catch (error) {
      // Ignore delete errors.
    }

    isMerging = false;
    setLoading(false);
  }
});

updateSlots(DEFAULT_SLOTS);
coverSecondsInput.value = String(DEFAULT_INTRO_SECONDS);
setLoading(false);
