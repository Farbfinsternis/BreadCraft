import type { BreadCraftApi } from './index'

declare global {
  interface Window {
    breadcraft: BreadCraftApi
  }
}
