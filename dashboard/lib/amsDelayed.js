/**
 * Matches classify.js isDelayedTask — Delayed custom field (Yes/No by option order).
 */

export function isAmsTaskDelayed(task) {
  if (!task) return false;
  if (task.delayedFlag) return String(task.delayedFlag).toLowerCase() === 'yes';
  const fields = task.customFields || task.custom_fields || [];
  const delayedField = fields.find((f) => String(f?.name || '').trim().toLowerCase() === 'delayed');
  if (!delayedField) return false;
  const value = delayedField.value;
  const options = delayedField?.type_config?.options || [];
  const byOrder = options.find((opt) => Number(opt?.orderindex) === Number(value));
  const selected = String(byOrder?.name || '').toLowerCase();
  return selected === 'yes' || value === 0 || value === '0';
}
