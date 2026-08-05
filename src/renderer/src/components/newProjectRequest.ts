import type { NewProjectRequest, RegionChoice, TemplateChoice } from '@renderer/stores/ui'

type T = (key: string) => string

/**
 * Build the New-Project dialog request. ONE place the dialog's content lives, so the
 * toolbar and the welcome page open the exact same dialog. There is still no screen-MODE
 * choice: a project has no single mode — `SetMode` switches it at runtime (ScreenMode
 * block). What the dialog does offer is a STARTER: plain text-mode scaffold, or a picture
 * project that arrives with an image to paint on and the lines that show it.
 */
export function buildNewProjectRequest(t: T): NewProjectRequest {
  // The starter, not the mode. `plain` first — it stays the default for a game.
  const templates: TemplateChoice[] = [
    {
      value: 'plain',
      label: t('newproject.template.plain'),
      hint: t('newproject.template.plain.hint')
    },
    {
      value: 'image',
      label: t('newproject.template.image'),
      hint: t('newproject.template.image.hint')
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
    templateLabel: t('newproject.templateLabel'),
    templates,
    regionLabel: t('newproject.regionLabel'),
    regions,
    boilerplateLabel: t('newproject.boilerplate'),
    confirmLabel: t('newproject.confirm')
  }
}
