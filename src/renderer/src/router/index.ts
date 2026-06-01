import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import CodeView from '@renderer/views/CodeView.vue'
import { useProjectStore } from '@renderer/stores/project'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'code', component: CodeView },
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@renderer/views/WelcomeView.vue')
  },
  {
    path: '/editor/tileset',
    name: 'tileset',
    component: () => import('@renderer/views/TilesetView.vue')
  },
  {
    path: '/editor/tilemap',
    name: 'tilemap',
    component: () => import('@renderer/views/TilemapView.vue')
  },
  {
    path: '/editor/sprite',
    name: 'sprite',
    component: () => import('@renderer/views/SpriteView.vue')
  },
  {
    path: '/editor/palette',
    name: 'palette',
    component: () => import('@renderer/views/PaletteView.vue')
  },
  {
    path: '/editor/sound',
    name: 'sound',
    component: () => import('@renderer/views/SoundView.vue')
  }
]

/** Route names of the graphics editors — the views where Zen mode (full-width,
 *  panels hidden) is offered and takes effect. Shared so the toolbar toggle and
 *  App.vue agree on "is this an editor route?" (one list, no drift). */
export const EDITOR_ROUTE_NAMES = ['palette', 'tileset', 'tilemap', 'sprite', 'sound'] as const

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// Editors require an open project — without one, saving would have nowhere to go
// (ASSET_DOCUMENTS.md §1). Redirect editor routes to the welcome page when no
// project is loaded. The store is safe to use here: Pinia is active by the time
// navigation runs (the app mounts pinia before the router resolves routes).
router.beforeEach((to) => {
  if ((EDITOR_ROUTE_NAMES as readonly string[]).includes(String(to.name))) {
    const project = useProjectStore()
    if (!project.dir) return { name: 'welcome' }
  }
  return true
})

export default router
