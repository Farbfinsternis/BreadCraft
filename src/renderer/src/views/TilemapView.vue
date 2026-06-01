<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="editor-stub">
    <span class="bc-label">{{ t('view.tilemap.title') }}</span>
    <p class="bc-body">{{ t('view.tilemap.empty') }}</p>
  </div>
</template>
