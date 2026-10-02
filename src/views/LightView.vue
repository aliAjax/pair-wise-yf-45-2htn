<script setup lang="ts">
import { computed } from "vue";
import { ElMessage } from "element-plus";
import { useScheduleStore } from "../stores/schedule";
import { WINDOW_BEFORE, WINDOW_AFTER } from "../stores/schedule";

const store = useScheduleStore();
const editable = computed(() => store.role === "制片" || store.role === "导演");

const lightScenes = computed(() => store.scenes.filter((item) => item.needsLight));
const nightScenes = computed(() => store.scenes.filter((item) => store.isNightScene(item)));
const revertedCount = computed(() => store.scenes.filter((item) => item.needsReconfirm).length);

function segMinutes(value: string) {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** 天光戏当前是否落在窗口内 */
function withinWindow(scene: { day: string; start: string; end: string; locationId: string }) {
  const segs = store.lightWindows(scene.locationId, scene.day);
  return segs.some((seg) => segMinutes(scene.start) >= segMinutes(seg.start) && segMinutes(scene.end) <= segMinutes(seg.end));
}

function onDawnChange(locId: string, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (!value) return;
  store.updateLocationDawn(locId, value);
  ElMessage.warning("窗口已变更，未开拍场次重算冲突并退回待确认");
}

function onLocChange(sceneId: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  store.updateScene(sceneId, { locationId: value });
  ElMessage.warning("场地已变更，未开拍场次重算冲突并退回待确认");
}

function schedule(sceneId: string, day: string, segKey: "before" | "after") {
  const result = store.scheduleToWindow(sceneId, day, segKey);
  if (result.ok) ElMessage.success("已排入天光窗口");
  else ElMessage.error(result.reason ?? "排入失败");
}

function split(sceneId: string) {
  const result = store.splitAcrossDays(sceneId);
  if (result.ok) ElMessage.success("已拆成两天，各占一段天光窗口");
  else ElMessage.error(result.reason ?? "拆分失败");
}

function hold(sceneId: string) {
  const result = store.holdResources(sceneId);
  if (result.ok) ElMessage.success("已占住灯组与演员档期");
  else ElMessage.warning(`占取失败，保留原排期。缺：${(result.missing ?? []).join("、")}`);
}
</script>

<template>
  <section class="page">
    <div v-if="revertedCount" class="draft-banner">
      <span>窗口或场地已变更，{{ revertedCount }} 个未开拍场次已重算冲突并退回待确认；已确认场次保持基准不动。</span>
    </div>

    <section class="panel">
      <div class="panel-head">
        <div><h2>场地与天光窗口</h2><small class="muted">按日出时间推算，天亮前 / 天亮后各 {{ WINDOW_BEFORE }} 分钟；窗口一改即重算冲突</small></div>
      </div>
      <div class="loc-grid">
        <article v-for="loc in store.locations" :key="loc.id" class="loc-card">
          <div class="loc-name">
            <b>{{ loc.name }}</b>
            <label class="dawn">日出
              <input type="time" :value="loc.dawn" :disabled="!editable" @change="onDawnChange(loc.id, $event)" />
            </label>
          </div>
          <div class="seg-row">
            <span v-for="seg in store.lightWindows(loc.id, '2026-10-08')" :key="seg.key" class="seg" :class="seg.key">
              <i>{{ seg.label }}</i><b>{{ seg.start }}–{{ seg.end }}</b>
            </span>
          </div>
        </article>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><h2>天光戏可用窗口</h2><small class="muted">按时长与场地 / 档期冲突算出可排时段；排超窗口拆成两天，不硬压</small></div>
      </div>
      <el-empty v-if="!lightScenes.length" description="暂无天光戏" />
      <article v-for="scene in lightScenes" :key="scene.id" class="light-card">
        <header>
          <div>
            <b>{{ scene.code }} {{ scene.title }}</b>
            <small>{{ scene.day }} {{ scene.start }}–{{ scene.end }} · 时长 {{ store.sceneDuration(scene) }} 分钟 ·
              <select class="loc-select" :value="scene.locationId" :disabled="!editable" @change="onLocChange(scene.id, $event)">
                <option v-for="loc in store.locations" :key="loc.id" :value="loc.id">{{ loc.name }}</option>
              </select>
            </small>
          </div>
          <span class="status" :class="withinWindow(scene) ? '已确认' : '草稿'">{{ withinWindow(scene) ? "在窗口内" : "超出窗口" }}</span>
        </header>
        <div class="slot-list">
          <div v-for="day in Array.from(new Set(store.availableWindows(scene.id).map((s) => s.day)))" :key="day" class="slot-day">
            <em>{{ day }}</em>
            <div class="slot-row">
              <template v-for="slot in store.availableWindows(scene.id).filter((s) => s.day === day)" :key="slot.segKey">
                <span class="slot" :class="{ fit: slot.fit && !slot.reasons.length, busy: !slot.fit || slot.reasons.length }">
                  <i>{{ slot.segLabel }}</i><b>{{ slot.start }}–{{ slot.end }}</b>
                  <small v-if="!slot.fit">超窗口</small>
                  <small v-else-if="slot.reasons.length" class="conflict-reason">{{ slot.reasons.join("；") }}</small>
                  <small v-else class="ok">可排</small>
                </span>
                <button v-if="slot.fit && !slot.reasons.length" class="secondary" :disabled="!editable" @click="schedule(scene.id, day, slot.segKey)">排入</button>
              </template>
            </div>
          </div>
        </div>
        <footer class="actions">
          <button class="primary" :disabled="!editable || store.sceneDuration(scene) <= WINDOW_BEFORE" @click="split(scene.id)">拆成两天</button>
          <small class="muted">时长超过单段窗口（{{ WINDOW_BEFORE }} 分钟）时可拆到相邻两天，各占一段</small>
        </footer>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><h2>夜戏灯组占住</h2><small class="muted">灯组与演员档期占不到时保留原排期并说明缺哪一项，不打乱后续夜戏</small></div>
      </div>
      <el-empty v-if="!nightScenes.length" description="暂无夜戏" />
      <article v-for="scene in nightScenes" :key="scene.id" class="light-card">
        <header>
          <div>
            <b>{{ scene.code }} {{ scene.title }}</b>
            <small>{{ scene.day }} {{ scene.start }}–{{ scene.end }} · {{ store.locationName(scene.locationId) }} · 灯组 {{ store.equipmentNames(scene.equipmentIds).join("、") }}</small>
          </div>
          <span v-if="scene.held" class="status 已确认">已占住</span>
          <span v-else class="status 草稿">未占住</span>
        </header>
        <div class="actions">
          <button class="primary" :disabled="!editable" @click="hold(scene.id)">占住灯组与档期</button>
          <small v-if="scene.needsReconfirm" class="conflict-reason">窗口/场地变更，需重新确认</small>
        </div>
      </article>
    </section>
  </section>
</template>

<style scoped>
.loc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
.loc-card { border: 1px solid var(--line); border-radius: 12px; padding: 13px; background: #fbfcfe; display: grid; gap: 10px; }
.loc-name { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dawn { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.dawn input { border: 1px solid #cfd7e5; border-radius: 8px; padding: 6px 8px; background: #fafbfd; }
.seg-row { display: flex; gap: 8px; flex-wrap: wrap; }
.seg { display: grid; gap: 2px; padding: 7px 10px; border-radius: 9px; font-size: 12px; }
.seg i { font-style: normal; color: var(--muted); }
.seg.before { background: #eef2fb; }
.seg.after { background: #fff3e8; }
.light-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: #fbfcfe; margin-bottom: 12px; display: grid; gap: 12px; }
.light-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.light-card header small { display: block; color: var(--muted); margin-top: 4px; }
.loc-select { border: 1px solid #cfd7e5; border-radius: 7px; padding: 3px 6px; background: #fafbfd; }
.slot-list { display: grid; gap: 8px; }
.slot-day { display: grid; gap: 5px; }
.slot-day > em { font-style: normal; font-size: 12px; color: var(--muted); }
.slot-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.slot { display: grid; gap: 2px; padding: 7px 10px; border-radius: 9px; font-size: 12px; min-width: 130px; }
.slot i { font-style: normal; color: var(--muted); }
.slot.fit { background: #e6f6ec; }
.slot.busy { background: #f6e9e9; }
.slot .ok { color: #19704b; }
.slot .conflict-reason { color: #c84545; }
</style>
