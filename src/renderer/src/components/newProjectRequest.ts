import type { NewProjectRequest, RegionChoice } from '@renderer/stores/ui'

type T = (key: string) => string

/**
 * Build the New-Project dialog request. ONE place the dialog's content lives, so the
 * toolbar and the welcome page open the exact same dialog. There is no screen-mode
 * choice: a project has no single mode — `SetMode` switches it at runtime (ScreenMode
 * block). New projects start in TEXT, MULTICOLOR, freely changed in the starter.
 */
export function buildNewProjectRequest(t: T): NewProjectRequest {
  // Target region (STAHL S5c) — both real choices, PAL first (the default). Picks the
  // PERF budget AND the region VICE boots, so it's a conscious choice, not a silent 50 Hz.
  const regions: RegionChoice[] = [
    {
      value: 'PAL',
      label: t('newproject.region.pal'),
      hint: t('newproject.region.pal.hint')
    },
    {
      value: 'NTSC',
      label: t('newproject.region.ntsc'),
      hint: t('newproject.region.ntsc.hint')
    }
  ]
  return {
    title: t('newproject.title'),
    nameLabel: t('newproject.nameLabel'),
    namePlaceholder: t('newproject.namePlaceholder'),
    regionLabel: t('newproject.regionLabel'),
    regions,
    boilerplateLabel: t('newproject.boilerplate'),
    confirmLabel: t('newproject.confirm')
  }
}
