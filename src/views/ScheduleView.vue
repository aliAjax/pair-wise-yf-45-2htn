<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage } from "element-plus";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useScheduleStore } from "../stores/schedule";
import type { Scene, SceneStatus } from "../types";

const store = useScheduleStore();
const saving = ref(false);
const dragging = ref<number | null>(null);
const form = reactive({ code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [] as string[], equipmentIds: [] as string[], needsDaylight: false });
const schema = toTypedSchema(z.object({
  code: z.string().min(2, "请输入场次编号"),
  title: z.string().min(2, "请输入场次名称"),
  day: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  locationId: z.string().min(1)
}));
const { errors, validate } = useForm({ validationSchema: schema });
const editable = computed(() => store.role === "制片" || store.role === "导演");
const currentStatus = (status: string) => status as SceneStatus;
const unshot = (scene: Scene) => scene.status === "草稿" || scene.status === "已确认";
const fitOf = (scene: Scene) => store.daylightFit(scene);
const splitParent = (scene: Scene) => store.scenes.find((item: Scene) => item.id === scene.splitFrom)?.code ?? "";

onMounted(() => store.loadDraft());

async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  saving.value = true;
  const created = store.addScene({ code: form.code, title: form.title, day: form.day, start: form.start, end: form.end, locationId: form.locationId, talentIds: [...form.talentIds], equipmentIds: [...form.equipmentIds], needsDaylight: form.needsDaylight });
  const fit = store.daylightFit(created);
  if (fit && !fit.fits) ElMessage.warning("已存为草稿，未硬压进通告：请在场次卡片上「拆成两天」或「按灯戏占住」");
  Object.assign(form, { code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [], equipmentIds: [], needsDaylight: false });
  setTimeout(() => { saving.value = false; }, 240);
}

function drop(index: number) {
  if (dragging.value !== null && editable.value) store.moveScene(dragging.value, index);
  dragging.value = null;
}

function overText(scene: Scene) {
  const fit = store.daylightFit(scene);
  if (!fit || fit.fits) return "";
  return fit.reason === "tooLong" ? `超出窗口 ${fit.overflowMin} 分钟，不能硬压` : "当前时段不在天光窗口内，不能硬压";
}

function onLocationChange(scene: Scene, event: Event) {
  store.changeSceneLocation(scene.id, (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article class="metric"><span>通告场次</span><strong>{{ store.scenes.length }}</strong></article>
      <article class="metric"><span>待处理冲突</span><strong>{{ store.conflicts.length }}</strong></article>
      <article class="metric"><span>已确认</span><strong>{{ store.scenes.filter((item: Scene) => item.status === '已确认').length }}</strong></article>
      <article class="metric"><span>版本快照</span><strong>{{ store.versions.length }}</strong></article>
    </div>
    <div v-if="store.draft" class="draft-banner">
      <span>发现 {{ dayjs(store.draft.savedAt).format("MM-DD HH:mm") }} 的离线草稿，共 {{ store.draft.scenes.length }} 个场次。</span>
      <div class="actions"><button class="secondary" @click="store.syncDraft">同步到正式通告</button></div>
    </div>
    <div class="grid-2">
      <div class="stack">
        <section class="panel">
          <div class="panel-head"><h2>新增场次</h2><button class="secondary" @click="store.saveDraft">保存离线草稿</button></div>
          <form class="form-grid" @submit.prevent="submit">
            <label class="field"><span>场次编号</span><input v-model="form.code" placeholder="C-018" /><small>{{ errors.code }}</small></label>
            <label class="field"><span>场次名称</span><input v-model="form.title" placeholder="例如：雨夜追踪" /><small>{{ errors.title }}</small></label>
            <label class="field"><span>拍摄日</span><input v-model="form.day" type="date" /></label>
            <label class="field"><span>场地</span><select v-model="form.locationId"><option v-for="item in store.locations" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <label class="field"><span>开始</span><input v-model="form.start" type="time" /></label>
            <label class="field"><span>结束</span><input v-model="form.end" type="time" /></label>
            <label class="field wide"><span>演员档期</span><select v-model="form.talentIds" multiple><option v-for="item in store.talents" :key="item.id" :value="item.id">{{ item.name }} · {{ item.role }}</option></select></label>
            <label class="field wide"><span>器材借用</span><select v-model="form.equipmentIds" multiple><option v-for="item in store.equipment" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
            <label class="field wide checkbox"><input v-model="form.needsDaylight" type="checkbox" /><span>靠天光拍摄（须完整落进场地天光窗口）</span></label>
            <div class="actions wide"><button class="primary" :disabled="saving || !editable">保存为草稿</button><RouterLink class="secondary" to="/conflicts">检查冲突</RouterLink></div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-head"><div><h2>场地天光窗口</h2><small class="muted">窗口或场地一变，未开拍场次立即重算冲突并退回待确认</small></div></div>
          <div v-for="loc in store.locations" :key="loc.id" class="window-row">
            <b>{{ loc.name }}</b>
            <label v-for="win in loc.windows" :key="win.id" class="window-inputs">
              <span>{{ win.label }}</span>
              <input v-model="win.start" type="time" :disabled="!editable" @change="store.updateLocationWindows(loc.id, loc.windows)" />
              <span>–</span>
              <input v-model="win.end" type="time" :disabled="!editable" @change="store.updateLocationWindows(loc.id, loc.windows)" />
            </label>
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-head"><div><h2>当日通告顺序</h2><small class="muted">拖拽调整拍摄顺序，版本快照后可随时恢复</small></div><button class="primary" :disabled="!editable" @click="store.snapshot()">保存版本</button></div>
        <div class="scene-list">
          <article v-for="(scene,index) in store.sortedScenes" :key="scene.id" class="scene" :class="{ locked: scene.locked, dragging: dragging === index }" draggable="true" @dragstart="dragging=index" @dragover.prevent @drop="drop(index)">
            <b>{{ index + 1 }}</b>
            <div class="scene-code">{{ scene.code }}</div>
            <div class="scene-title"><b>{{ scene.title }}</b><small>{{ scene.day }} {{ scene.start }}–{{ scene.end }} · {{ store.locationName(scene.locationId) }}</small></div>
            <span class="status" :class="scene.status">{{ scene.status === '草稿' ? '待确认' : scene.status }}</span>
            <div class="actions">
              <button class="secondary" :disabled="!editable || scene.locked || (scene.status === '草稿' && !store.canConfirm(scene))" :title="scene.status === '草稿' && !store.canConfirm(scene) ? '超窗口未处理，不能硬压进通告' : ''" @click="store.updateStatus(scene.id, currentStatus(scene.status === '草稿' ? '已确认' : scene.status === '已确认' ? '拍摄中' : scene.status === '拍摄中' ? '已完成' : '已完成'))">推进</button>
              <button class="secondary" :disabled="!editable" @click="store.toggleLock(scene.id)">{{ scene.locked ? "解锁" : "锁定" }}</button>
            </div>
            <div class="scene-meta wide">
              <small>演员：{{ store.talentNames(scene.talentIds).join("、") || "待定" }} · 器材：{{ store.equipmentNames(scene.equipmentIds).join("、") || "无" }}</small>
              <small v-if="scene.splitFrom" class="split-tag">由 {{ splitParent(scene) }} 拆出</small>
              <label v-if="editable && !scene.locked && unshot(scene)" class="loc-picker">场地
                <select :value="scene.locationId" @change="onLocationChange(scene, $event)">
                  <option v-for="item in store.locations" :key="item.id" :value="item.id">{{ item.name }}</option>
                </select>
              </label>
            </div>
            <div v-if="scene.needsDaylight" class="daylight wide" :class="{ over: !store.canConfirm(scene) }">
              <small>天光窗口 · {{ store.locationName(scene.locationId) }}：{{ store.windowsText(scene.locationId) }}</small>
              <small v-if="fitOf(scene)?.fits" class="ok">✓ 已排进{{ fitOf(scene)?.windowLabel }}窗口</small>
              <small v-else-if="scene.nightHold" class="ok">✓ 已按灯戏占住 LED灯组 与演员档期，转夜拍</small>
              <template v-else>
                <small class="warn">⚠ {{ overText(scene) }}</small>
                <div class="actions">
                  <button class="secondary" :disabled="!editable" @click="store.splitScene(scene.id)">拆成两天</button>
                  <button class="secondary" :disabled="!editable" @click="store.holdAsNight(scene.id)">按灯戏占住</button>
                </div>
              </template>
              <small v-if="scene.holdNote" class="hold-note">保留原排期：{{ scene.holdNote }}</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
