import type { NewProjectRequest, ModeChoice, RegionChoice } from '@renderer/stores/ui'

type T = (key: string) => string

/**
 * Build the New-Project dialog request (M1.T6). ONE place the dialog's content
 * lives, so the toolbar and the welcome page open the exact same dialog. The
 * graphics-mode list shows all three Phase-1 modes (IDE.md §2.1), but only
 * TEXT_MULTICOLOR is enabled for now — the others are visible-but-disabled
 * ("coming later"), matching the roadmap (M1.T6) and the build's real coverage.
 */
export function buildNewProjectRequest(t: T): NewProjectRequest {
  const later = ` ${t('newproject.comingLater')}`
  const modes: ModeChoice[] = [
    {
      value: 'TEXT_MULTICOLOR',
      label: t('newproject.mode.textMulticolor'),
      hint: t('newproject.mode.textMulticolor.hint')
    },
    {
      value: 'TEXT_HIRES',
      label: t('newproject.mode.textHires') + later,
      hint: t('newproject.mode.textHires.hint'),
      disabled: true
    },
    {
      value: 'BITMAP_MULTICOLOR',
      label: t('newproject.mode.bitmapMulticolor') + later,
      hint: t('newproject.mode.bitmapMulticolor.hint'),
      disabled: true
    }
  ]
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
    modeLabel: t('newproject.modeLabel'),
    modes,
    regionLabel: t('newproject.regionLabel'),
    regions,
    boilerplateLabel: t('newproject.boilerplate'),
    confirmLabel: t('newproject.confirm')
  }
}
