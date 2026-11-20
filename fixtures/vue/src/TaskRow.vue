<script setup lang="ts">
import { computed } from 'vue';
import type { Task } from './types';

const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ toggle: []; delete: [] }>();
const done = computed({
  get: () => props.task.done,
  set: () => emit('toggle'),
});
</script>

<template>
  <li class="task" :class="{ 'is-done': task.done }">
    <input type="checkbox" :id="`task-${task.id}`" v-model="done">
    <label :for="`task-${task.id}`">{{ task.title }}</label>
    <button type="button" class="btn btn-icon" :aria-label="`Delete ${task.title}`" @click="emit('delete')">×</button>
  </li>
</template>
