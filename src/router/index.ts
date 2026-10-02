import { createRouter, createWebHashHistory } from "vue-router";
import ScheduleView from "../views/ScheduleView.vue";
import ConflictView from "../views/ConflictView.vue";
import HistoryView from "../views/HistoryView.vue";
import LightView from "../views/LightView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "schedule", component: ScheduleView },
    { path: "/conflicts", name: "conflicts", component: ConflictView },
    { path: "/light", name: "light", component: LightView },
    { path: "/history", name: "history", component: HistoryView }
  ]
});
