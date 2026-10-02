import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { Conflict, DaylightFit, DaylightWindow, Equipment, HistoryEntry, Location, OfflineDraft, Role, Scene, SceneStatus, Talent, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";
const LIGHT_GROUP_ID = "e3"; // LED灯组：几个夜戏共用

const talents: Talent[] = [
  { id: "t1", name: "林川", role: "男主" },
  { id: "t2", name: "周禾", role: "女主" },
  { id: "t3", name: "顾言", role: "配角" },
  { id: "t4", name: "孙宁", role: "群演领队" }
];

const seedLocations: Location[] = [
  { id: "l1", name: "老码头", windows: [
    { id: "l1-pre", label: "天亮前", start: "04:50", end: "05:50" },
    { id: "l1-post", label: "天亮后", start: "06:10", end: "07:40" }
  ] },
  { id: "l2", name: "玻璃厂房", windows: [
    { id: "l2-pre", label: "天亮前", start: "05:05", end: "06:05" },
    { id: "l2-post", label: "天亮后", start: "06:25", end: "07:55" }
  ] },
  { id: "l3", name: "南站候车厅", windows: [
    { id: "l3-pre", label: "天亮前", start: "05:20", end: "06:20" },
    { id: "l3-post", label: "天亮后", start: "06:40", end: "08:00" }
  ] }
];

const equipment: Equipment[] = [
  { id: "e1", name: "ARRI A机" },
  { id: "e2", name: "移动伸缩炮" },
  { id: "e3", name: "LED灯组" },
  { id: "e4", name: "跟拍车" }
];

const seedScenes: Scene[] = [
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1", "e3"], status: "已确认", locked: false },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false },
  { id: "s4", code: "C-031", title: "滩涂日出", day: "2026-10-09", start: "05:00", end: "07:30", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e1"], status: "草稿", locked: false, needsDaylight: true },
  { id: "s5", code: "D-040", title: "码头灯火夜戏", day: "2026-10-09", start: "20:00", end: "23:00", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e3", "e4"], status: "已确认", locked: false },
  { id: "s6", code: "D-041", title: "厂房对峙夜戏", day: "2026-10-09", start: "21:30", end: "23:30", talentIds: ["t2"], locationId: "l2", equipmentIds: ["e3"], status: "草稿", locked: false }
];

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).scenes as Scene[] : structuredClone(seedScenes);
  } catch {
    return structuredClone(seedScenes);
  }
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).history as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function readVersions(): Version[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).versions as Version[] : [];
  } catch {
    return [];
  }
}

function readLocations(): Location[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.locations ? parsed.locations as Location[] : structuredClone(seedLocations);
  } catch {
    return structuredClone(seedLocations);
  }
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function fmt(total: number) {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const locations = ref<Location[]>(readLocations());
  const role = ref<Role>("制片");
  const exemptions = ref<string[]>([]);
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationOf = (id: string) => locations.value.find((item) => item.id === id);
  const locationName = (id: string) => locationOf(id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);
  const windowsText = (locationId: string) => {
    const loc = locationOf(locationId);
    return loc && loc.windows.length ? loc.windows.map((item) => `${item.label} ${item.start}–${item.end}`).join(" / ") : "未设置";
  };

  // 按场地算出每场天光戏的可用窗口，判断当前排期能否完整落进某一段窗口
  function daylightFit(scene: Scene): DaylightFit | null {
    if (!scene.needsDaylight) return null;
    const durationMin = minutes(scene.end) - minutes(scene.start);
    const windows = locationOf(scene.locationId)?.windows ?? [];
    const containing = windows.find((item) => minutes(scene.start) >= minutes(item.start) && minutes(scene.end) <= minutes(item.end));
    if (containing) return { fits: true, reason: "ok", windowLabel: containing.label, overflowMin: 0, durationMin };
    const longest = windows.reduce((max, item) => Math.max(max, minutes(item.end) - minutes(item.start)), 0);
    if (durationMin > longest) return { fits: false, reason: "tooLong", windowLabel: "", overflowMin: durationMin - longest, durationMin };
    return { fits: false, reason: "outside", windowLabel: "", overflowMin: 0, durationMin };
  }

  // 超窗口未处理的天光戏不允许硬压进通告
  function canConfirm(scene: Scene) {
    const fit = daylightFit(scene);
    return !fit || fit.fits || !!scene.nightHold;
  }

  const conflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        const id = `${a.id}:${b.id}`;
        if (exemptions.value.includes(id)) continue;
        if (shared(a.talentIds, b.talentIds)) result.push({ id: `${id}:talent`, type: "演员档期", sceneIds: [a.id, b.id], message: `${talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、")} 在两场戏中档期重叠`, severity: "高" });
        if (a.locationId === b.locationId) result.push({ id: `${id}:location`, type: "场地占用", sceneIds: [a.id, b.id], message: `${locationName(a.locationId)} 被同时占用`, severity: "高" });
        if (shared(a.equipmentIds, b.equipmentIds)) result.push({ id: `${id}:equipment`, type: "器材借用", sceneIds: [a.id, b.id], message: `${equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、")} 发生借用重叠`, severity: "中" });
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30) result.push({ id: `${id}:transfer`, type: "转场时间", sceneIds: [a.id, b.id], message: "两个场地之间转场时间不足30分钟", severity: "中" });
      }
    }
    for (const scene of scenes.value) {
      if (scene.status === "拍摄中" || scene.status === "已完成") continue;
      const fit = daylightFit(scene);
      if (!fit || fit.fits || scene.nightHold) continue;
      const id = `daylight:${scene.id}`;
      if (exemptions.value.includes(id)) continue;
      const longest = fit.durationMin - fit.overflowMin;
      result.push({
        id,
        type: "天光窗口",
        sceneIds: [scene.id],
        message: scene.holdNote
          ? `${scene.code} ${scene.title} 保留原排期：${scene.holdNote}`
          : `${scene.code} ${scene.title} 需靠天光拍摄，${locationName(scene.locationId)}窗口（${windowsText(scene.locationId)}）${fit.reason === "tooLong" ? `最长仅 ${longest} 分钟，容纳不下 ${fit.durationMin} 分钟` : "与当前时段不相交"}，请拆成两天或按灯戏占住`,
        severity: scene.holdNote ? "中" : "高"
      });
    }
    return result;
  });

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenes: scenes.value, history: history.value, versions: versions.value, locations: locations.value }));
  }

  watch([scenes, history, versions, locations], persist, { deep: true });

  function addScene(input: Omit<Scene, "id" | "status" | "locked">) {
    const scene: Scene = { ...input, id: crypto.randomUUID(), status: "草稿", locked: false };
    scenes.value.push(scene);
    log("新增场次", `${input.code} ${input.title}`);
    return scene;
  }

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
    if (status === "已确认" && !canConfirm(scene)) {
      log("拦截硬压", `${scene.code} 超窗口未处理，不能确认，请拆成两天或按灯戏占住`);
      return;
    }
    scene.status = status;
    log("流转状态", `${scene.code} → ${status}`);
  }

  function toggleLock(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    scene.locked = !scene.locked;
    log(scene.locked ? "锁定场次" : "解锁场次", scene.code);
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.value.length) return;
    const [item] = scenes.value.splice(from, 1);
    scenes.value.splice(to, 0, item);
    log("调整顺序", `${item.code} 移至第 ${to + 1} 位`);
  }

  // 超窗口的天光戏拆成两天：当天按重叠最多的窗口截断，剩余分钟移到次日同一窗口
  function splitScene(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || !scene.needsDaylight || scene.status === "拍摄中" || scene.status === "已完成") return;
    const loc = locationOf(scene.locationId);
    if (!loc || !loc.windows.length) return;
    const total = minutes(scene.end) - minutes(scene.start);
    const overlapLen = (item: DaylightWindow) => Math.max(0, Math.min(minutes(scene.end), minutes(item.end)) - Math.max(minutes(scene.start), minutes(item.start)));
    const best = [...loc.windows].sort((a, b) => minutes(a.start) - minutes(b.start)).reduce((acc, item) => (overlapLen(item) > overlapLen(acc) ? item : acc), loc.windows[0]);
    const part1Len = Math.min(total, minutes(best.end) - minutes(best.start));
    const remain = total - part1Len;
    scene.start = best.start;
    scene.end = fmt(minutes(best.start) + part1Len);
    scene.status = "草稿";
    scene.nightHold = false;
    scene.holdNote = undefined;
    if (remain > 0) {
      scenes.value.push({
        ...structuredClone(scene),
        id: crypto.randomUUID(),
        code: `${scene.code}-续`,
        day: dayjs(scene.day).add(1, "day").format("YYYY-MM-DD"),
        start: best.start,
        end: fmt(minutes(best.start) + remain),
        status: "草稿",
        splitFrom: scene.id
      });
    }
    log("拆成两天", `${scene.code} 按${loc.name}${best.label}窗口截断，余 ${remain} 分钟移至次日同一窗口`);
  }

  // 按灯戏占住灯组和演员档期；占不到时保留原排期并说明缺哪一项
  function holdAsNight(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.status === "拍摄中" || scene.status === "已完成") return;
    const others = scenes.value.filter((item) => item.id !== id && overlaps(item, scene));
    const missing: string[] = [];
    if (others.some((item) => item.equipmentIds.includes(LIGHT_GROUP_ID))) missing.push("灯组");
    const busyTalents = scene.talentIds.filter((tid) => others.some((item) => item.talentIds.includes(tid)));
    if (busyTalents.length) missing.push(`演员档期（${talentNames(busyTalents).join("、")}）`);
    if (missing.length) {
      scene.nightHold = false;
      scene.holdNote = `缺${missing.join("、")}，未改动原排期`;
      log("灯戏占住失败", `${scene.code} ${scene.holdNote}`);
      return;
    }
    if (!scene.equipmentIds.includes(LIGHT_GROUP_ID)) scene.equipmentIds.push(LIGHT_GROUP_ID);
    scene.nightHold = true;
    scene.holdNote = undefined;
    log("按灯戏占住", `${scene.code} 已占住 LED灯组 与演员档期（${scene.day} ${scene.start}–${scene.end}），转夜拍`);
  }

  // 制片确认过的场次当作基准：窗口或场地一变，未开拍场次重算冲突并退回待确认
  function recalcUnshot(reason: string) {
    const affected = scenes.value.filter((item) => item.status === "已确认");
    for (const item of affected) item.status = "草稿";
    log("重算冲突", affected.length ? `${reason}，${affected.map((item) => item.code).join("、")} 退回待确认` : `${reason}，无已确认场次受影响`);
  }

  function updateLocationWindows(locationId: string, windows: DaylightWindow[]) {
    const loc = locationOf(locationId);
    if (!loc) return;
    loc.windows = windows.map((item) => ({ ...item }));
    recalcUnshot(`${loc.name}窗口变更为 ${windowsText(locationId)}`);
  }

  function changeSceneLocation(id: string, locationId: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked || scene.status === "拍摄中" || scene.status === "已完成" || scene.locationId === locationId) return;
    scene.locationId = locationId;
    scene.holdNote = undefined;
    recalcUnshot(`${scene.code} 场地变更为${locationName(locationId)}`);
  }

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: structuredClone(scenes.value) });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = structuredClone(version.scenes);
    log("恢复版本", version.name);
  }

  function saveDraft() {
    draft.value = { scenes: structuredClone(scenes.value), savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    log("保存离线草稿", dayjs(draft.value.savedAt).format("MM-DD HH:mm"));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      draft.value = raw ? JSON.parse(raw) as OfflineDraft : null;
    } catch {
      draft.value = null;
    }
  }

  function syncDraft() {
    if (!draft.value) return;
    scenes.value = structuredClone(draft.value.scenes);
    log("同步离线草稿", `同步 ${draft.value.scenes.length} 个场次`);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
  }

  function exempt(id: string) {
    exemptions.value.push(id);
    log("豁免冲突", id);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  return { scenes, sortedScenes, conflicts, history, versions, locations, role, exemptions, online, draft, talents, equipment, talentNames, equipmentNames, locationName, windowsText, daylightFit, canConfirm, addScene, updateStatus, toggleLock, moveScene, splitScene, holdAsNight, updateLocationWindows, changeSceneLocation, snapshot, restore, saveDraft, loadDraft, syncDraft, exempt, setOnline };
});
