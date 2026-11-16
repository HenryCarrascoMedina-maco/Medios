import { Pipe, PipeTransform } from '@angular/core';

/**
 * Marcado mínimo de las guías: **negrita**, *cursiva*, `código`, [texto](https://…) y {{variable}}.
 * Escapa el HTML antes de aplicar el marcado, así que el resultado es seguro para [innerHTML].
 */
@Pipe({ name: 'richText' })
export class RichTextPipe implements PipeTransform {
  transform(text: string, vars: Record<string, string> = {}): string {
    return escapeHtml(fillVars(text, vars))
      .replace(/`([^`]+)`/g, '<code class="rounded bg-surface-muted px-1 py-0.5 text-[0.85em] break-words">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
}

export function fillVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '…');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
