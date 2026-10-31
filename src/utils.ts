import { ref, watch } from 'vue';

function loadString(key: string, fallback: string) {
  return (localStorage.getItem(key) ?? fallback).trim();
}

function loadBool(key: string, fallback: boolean) {
  const saved = localStorage.getItem(key);
  return saved === null ? fallback : saved === 'true';
}

function loadNumber(key: string, fallback: number) {
  const saved = localStorage.getItem(key);
  if (saved === null) return fallback;
  const n = Number(saved);
  return Number.isFinite(n) ? n : fallback;
}

export function defineReference<T extends string | number | boolean>(
  name: string,
  fallback: T,
  options: readonly T[] = [],
  onChange?: (value: T) => void,
) {
  const initialValue =
    typeof fallback === 'string'
      ? loadString(name, fallback)
      : typeof fallback === 'number'
        ? loadNumber(name, fallback)
        : loadBool(name, fallback);
  const reference = ref<T>(initialValue as T);
  watch(reference, value => {
    localStorage.setItem(name, String(value));
    onChange?.(value as T);
  });
  if (options.length && !options.includes(reference.value as T)) {
    reference.value = fallback;
  }
  return reference;
}
