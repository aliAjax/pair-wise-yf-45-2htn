import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { Conflict, Equipment, HistoryEntry, Location, OfflineDraft, Role, Scene, SceneStatus, Talent, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";

/** 天光窗口：天亮前 / 天亮后各 50 分钟 */
export const WINDOW_BEFORE = 50;
export const WINDOW_AFTER = 50;
/** 拆成两天时最多拆成几段 */
const MAX_SPLIT_PARTS = 2;
/** 可用窗口向后推算的天数 */
const WINDOW_HORIZON = 7;

const talents: Talent[] = [
  { id: "t1", name: "林川", role: "男主" },
  { id: "t2", name: "周禾", role: "女主" },
  { id: "t3", name: "顾言", role: "配角" },
  { id: "t4", name: "孙宁", role: "群演领队" }
];

const locations: Location[] = [
  { id: "l1", name: "老码头", dawn: "06:12" },
  { id: "l2", name: "玻璃厂房", dawn: "06:16" },
  { id: "l3", name: "南站候车厅", dawn: "06:08" }
];

const equipment: Equipment[] = [
  { id: "e1", name: "ARRI A机" },
  { id: "e2", name: "移动伸缩炮" },
  { id: "e3", name: "LED灯组" },
  { id: "e4", name: "跟拍车" }
];

const seedScenes: Scene[] = [
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "06:12", end: "06:52", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1"], status: "已确认", locked: false, needsLight: true, held: false },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false, needsLight: false, held: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false, needsLight: false, held: false },
  { id: "s4", code: "C-031", title: "码头夜捕", day: "2026-10-08", start: "19:30", end: "22:00", talentIds: ["t1", "t4"], locationId: "l1", equipmentIds: ["e3"], status: "草稿", locked: false, needsLight: false, held: false },
  { id: "s5", code: "C-032", title: "厂房夜谈", day: "2026-10-08", start: "20:00", end: "22:30", talentIds: ["t2", "t3"], locationId: "l2", equipmentIds: ["e3"], status: "草稿", locked: false, needsLight: false, held: false },
  { id: "s6", code: "B-024", title: "码头晨训", day: "2026-10-09", start: "05:00", end: "06:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1"], status: "草稿", locked: false, needsLight: true, held: false },
  { id: "s7", code: "C-034", title: "码头夜话", day: "2026-10-09", start: "17:00", end: "19:30", talentIds: ["t2", "t4"], locationId: "l1", equipmentIds: ["e3"], status: "草稿", locked: false, needsLight: false, held: false },
  { id: "s8", code: "C-035", title: "码头夜归", day: "2026-10-10", start: "19:00", end: "21:30", talentIds: ["t3", "t4"], locationId: "l2", equipmentIds: ["e3"], status: "草稿", locked: false, needsLight: false, held: false }
];

/** 兼容旧存档：补齐新增字段 */
function normalizeScene(raw: Partial<Scene>): Scene {
  return { needsLight: false, held: false, ...raw } as Scene;
}

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw).scenes as Partial<Scene>[]) : structuredClone(seedScenes);
    return list.map(normalizeScene);
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

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

function fmtMin(value: number) {
  const h = Math.floor(value / 60);
  const m = ((value % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function addMin(value: string, minutes: number) {
  return fmtMin(minutes + (Number(value.split(":")[0]) * 60 + Number(value.split(":")[1])));
}

interface WindowSegment {
  key: "before" | "after";
  label: string;
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  len: number;
}

/** 按场地算天光窗口：天亮前 / 天亮后各一段 */
function windowSegments(locationId: string, day: string): WindowSegment[] {
  const loc = locations.find((item) => item.id === locationId);
  const dawn = loc ? minutes(loc.dawn) : 6 * 60;
  return [
    { key: "before", label: "天亮前", start: fmtMin(dawn - WINDOW_BEFORE), end: fmtMin(dawn), startMin: dawn - WINDOW_BEFORE, endMin: dawn, len: WINDOW_BEFORE },
    { key: "after", label: "天亮后", start: fmtMin(dawn), end: fmtMin(dawn + WINDOW_AFTER), startMin: dawn, endMin: dawn + WINDOW_AFTER, len: WINDOW_AFTER }
  ];
}

function sceneDuration(scene: Scene) {
  return minutes(scene.end) - minutes(scene.start);
}

/** 夜戏：使用 LED 灯组的场次 */
function isNightScene(scene: Scene) {
  return scene.equipmentIds.includes("e3");
}

function overlapTime(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

/** 某场次在指定时段内的资源冲突（场地 / 演员档期），返回冲突原因 */
function slotConflicts(scenes: Scene[], scene: Scene, day: string, startMin: number, endMin: number): string[] {
  const reasons: string[] = [];
  for (const other of scenes) {
    if (other.id === scene.id) continue;
    if (scene.splitGroup && other.splitGroup === scene.splitGroup) continue;
    if (other.day !== day) continue;
    if (!(minutes(other.start) < endMin && startMin < minutes(other.end))) continue;
    if (other.locationId === scene.locationId) reasons.push(`场地被 ${other.code} 占用`);
    const sharedTalent = scene.talentIds.filter((id) => other.talentIds.includes(id));
    if (sharedTalent.length) reasons.push(`${sharedTalent.map((id) => talents.find((t) => t.id === id)?.name ?? id).join("、")} 档期被 ${other.code} 占用`);
  }
  return reasons;
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const role = ref<Role>("制片");
  const exemptions = ref<string[]>([]);
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

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
    // 天光窗口冲突：天光戏必须落在天亮前/天亮后窗口内，且时长不得超过单段窗口
    for (const scene of scenes.value) {
      if (!scene.needsLight) continue;
      const dur = sceneDuration(scene);
      const segs = windowSegments(scene.locationId, scene.day);
      const maxSeg = Math.max(...segs.map((seg) => seg.len));
      const within = segs.some((seg) => minutes(scene.start) >= seg.startMin && minutes(scene.end) <= seg.endMin);
      if (dur > maxSeg) {
        result.push({ id: `${scene.id}:window`, type: "天光窗口", sceneIds: [scene.id], message: `${scene.code} ${scene.title} 时长 ${dur} 分钟超过天光单段窗口（${maxSeg} 分钟），建议拆成两天`, severity: "高" });
      } else if (!within) {
        result.push({ id: `${scene.id}:window`, type: "天光窗口", sceneIds: [scene.id], message: `${scene.code} ${scene.title} 未落在天光窗口内，请排入天亮前 / 天亮后`, severity: "高" });
      }
    }
    return result;
  });

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenes: scenes.value, history: history.value, versions: versions.value }));
  }

  watch([scenes, history, versions], persist, { deep: true });

  function addScene(input: Omit<Scene, "id" | "status" | "locked" | "held"> & { needsLight?: boolean }) {
    scenes.value.push({ ...input, id: crypto.randomUUID(), status: "草稿", locked: false, held: false, needsLight: input.needsLight ?? false });
    log("新增场次", `${input.code} ${input.title}`);
  }

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
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

  /** 某场地某天的天光窗口（天亮前 / 天亮后） */
  function lightWindows(locationId: string, day: string) {
    return windowSegments(locationId, day);
  }

  /**
   * 天光戏的可用窗口：按场地向后推算，列出每个可排时段。
   * fit=时长能塞进该段；reasons=该时段的资源冲突（场地 / 档期）。
   */
  function availableWindows(sceneId: string) {
    const scene = scenes.value.find((item) => item.id === sceneId);
    if (!scene || !scene.needsLight) return [];
    const dur = sceneDuration(scene);
    const start = dayjs(scene.day);
    const out: { day: string; segKey: "before" | "after"; segLabel: string; start: string; end: string; fit: boolean; reasons: string[] }[] = [];
    for (let i = 0; i < WINDOW_HORIZON; i += 1) {
      const day = start.add(i, "day").format("YYYY-MM-DD");
      for (const seg of windowSegments(scene.locationId, day)) {
        const reasons = slotConflicts(scenes.value, scene, day, seg.startMin, seg.endMin);
        out.push({ day, segKey: seg.key, segLabel: seg.label, start: seg.start, end: seg.end, fit: dur <= seg.len, reasons });
      }
    }
    return out;
  }

  /** 把天光戏排入某天某段窗口；超窗口或有冲突时不硬压，返回原因 */
  function scheduleToWindow(sceneId: string, day: string, segKey: "before" | "after"): { ok: boolean; reason?: string } {
    const scene = scenes.value.find((item) => item.id === sceneId);
    if (!scene || !scene.needsLight) return { ok: false, reason: "该场次不是天光戏" };
    const seg = windowSegments(scene.locationId, day).find((item) => item.key === segKey);
    if (!seg) return { ok: false, reason: "无此窗口" };
    const dur = sceneDuration(scene);
    if (dur > seg.len) return { ok: false, reason: `时长 ${dur} 分钟超过${seg.label}窗口（${seg.len} 分钟），建议拆成两天` };
    const reasons = slotConflicts(scenes.value, scene, day, seg.startMin, seg.endMin);
    if (reasons.length) return { ok: false, reason: reasons.join("；") };
    scene.day = day;
    scene.start = seg.start;
    scene.end = addMin(seg.start, dur);
    scene.needsReconfirm = false;
    log("排入天光窗口", `${scene.code} ${day} ${seg.label}`);
    return { ok: true };
  }

  /** 天光戏排超窗口时拆成两天（最多两段），各占一段窗口，不硬压进同一天 */
  function splitAcrossDays(sceneId: string): { ok: boolean; reason?: string } {
    const scene = scenes.value.find((item) => item.id === sceneId);
    if (!scene || !scene.needsLight) return { ok: false, reason: "该场次不是天光戏" };
    const dur = sceneDuration(scene);
    const parts = Math.ceil(dur / WINDOW_BEFORE);
    if (parts > MAX_SPLIT_PARTS) return { ok: false, reason: `时长 ${dur} 分钟，拆成两天仍超过单段窗口（${WINDOW_BEFORE} 分钟）` };
    const partDur = Math.ceil(dur / parts);
    const group = crypto.randomUUID();
    const plan: { day: string; seg: WindowSegment }[] = [];
    let cursor = dayjs(scene.day);
    for (let p = 0; p < parts; p += 1) {
      let picked: { day: string; seg: WindowSegment } | null = null;
      for (let i = 0; i < 14; i += 1) {
        const day = cursor.add(i, "day").format("YYYY-MM-DD");
        for (const seg of windowSegments(scene.locationId, day)) {
          if (partDur > seg.len) continue;
          if (!slotConflicts(scenes.value, scene, day, seg.startMin, seg.endMin).length) {
            picked = { day, seg };
            break;
          }
        }
        if (picked) break;
      }
      if (!picked) return { ok: false, reason: `第 ${p + 1} 段找不到可用窗口` };
      plan.push(picked);
      cursor = dayjs(picked.day).add(1, "day");
    }
    scene.splitGroup = group;
    scene.splitPart = 1;
    scene.day = plan[0].day;
    scene.start = plan[0].seg.start;
    scene.end = addMin(plan[0].seg.start, partDur);
    scene.needsReconfirm = false;
    for (let p = 1; p < parts; p += 1) {
      scenes.value.push({
        ...scene,
        id: crypto.randomUUID(),
        code: `${scene.code}-${p + 1}`,
        day: plan[p].day,
        start: plan[p].seg.start,
        end: addMin(plan[p].seg.start, partDur),
        splitGroup: group,
        splitPart: p + 1,
        status: "草稿",
        held: false,
        needsReconfirm: false
      });
    }
    log("拆成两天", `${scene.code} 拆为 ${parts} 段，各占一段天光窗口`);
    return { ok: true };
  }

  /**
   * 夜戏占住灯组与演员档期。占不到时保留原排期（不挪动场次），并说明缺哪一项。
   */
  function holdResources(sceneId: string): { ok: boolean; missing?: string[] } {
    const scene = scenes.value.find((item) => item.id === sceneId);
    if (!scene) return { ok: false };
    if (!isNightScene(scene)) return { ok: false, missing: ["该场次不使用灯组"] };
    const missing: string[] = [];
    const lightTaken = scenes.value.some((item) => item.id !== scene.id && item.day === scene.day && item.equipmentIds.includes("e3") && overlapTime(item, scene));
    if (lightTaken) missing.push("灯组");
    const talentTaken = scenes.value.some((item) => item.id !== scene.id && item.day === scene.day && shared(item.talentIds, scene.talentIds) && overlapTime(item, scene));
    if (talentTaken) missing.push("档期");
    if (missing.length) {
      scene.held = false; // 占不到则保留原排期，不挪动场次
      log("占取失败，保留原排期", `${scene.code} 缺${missing.join("、")}，未打乱后续夜戏`);
      return { ok: false, missing };
    }
    scene.held = true;
    log("占住灯组与演员档期", scene.code);
    return { ok: true };
  }

  /** 窗口或场地变更后：未开拍场次立即重算冲突并退回待确认；已确认场次作为基准不动 */
  function recomputeAfterChange() {
    let reverted = 0;
    for (const scene of scenes.value) {
      if (scene.status === "草稿") {
        scene.needsReconfirm = true;
        reverted += 1;
      }
    }
    log("窗口/场地变更", `已重算冲突，${reverted} 个未开拍场次退回待确认`);
  }

  /** 编辑场次；场地一变即触发重算 */
  function updateScene(id: string, patch: Partial<Scene>) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    const locationChanged = patch.locationId !== undefined && patch.locationId !== scene.locationId;
    Object.assign(scene, patch);
    if (locationChanged) recomputeAfterChange();
  }

  /** 调整场地日出时间（窗口一变即触发重算） */
  function updateLocationDawn(locationId: string, dawn: string) {
    const loc = locations.find((item) => item.id === locationId);
    if (!loc) return;
    loc.dawn = dawn;
    recomputeAfterChange();
  }

  return { scenes, sortedScenes, conflicts, history, versions, role, exemptions, online, draft, talents, locations, equipment, talentNames, equipmentNames, locationName, addScene, updateStatus, toggleLock, moveScene, snapshot, restore, saveDraft, loadDraft, syncDraft, exempt, setOnline, lightWindows, availableWindows, scheduleToWindow, splitAcrossDays, holdResources, recomputeAfterChange, updateScene, updateLocationDawn, isNightScene, sceneDuration };
});
