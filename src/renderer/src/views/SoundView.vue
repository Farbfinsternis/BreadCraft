<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="editor-stub">
    <span class="bc-label">{{ t('view.sound.title') }}</span>
    <p class="bc-body">{{ t('view.sound.todo') }}</p>
  </div>
</template>
