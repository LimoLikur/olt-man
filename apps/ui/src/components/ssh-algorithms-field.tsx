import { SSH_LEGACY_ALGORITHMS, type SshAlgorithmKind, type SshAlgorithms } from '@olt/shared/ssh-algorithms';
import { Button } from './ui';

const KINDS = Object.keys(SSH_LEGACY_ALGORITHMS) as SshAlgorithmKind[];
const LABEL: Record<SshAlgorithmKind, string> = { kex: 'Key exchange', serverHostKey: 'Host key', cipher: 'Cipher', hmac: 'MAC' };
/** Every allowlisted algorithm, in allowlist order. */
const ALL = Object.fromEntries(KINDS.map((k) => [k, [...SSH_LEGACY_ALGORITHMS[k]]])) as SshAlgorithms;

/** Flat list for display, e.g. "aes128-cbc, diffie-hellman-group14-sha1". */
export const algorithmList = (v: SshAlgorithms) => KINDS.flatMap((k) => v[k] ?? []);

/** Checkbox groups for olt.ssh_algorithms (allowlist from @olt/shared, checked again by the api). */
export function SshAlgorithmsField({ value, onChange }: { value: SshAlgorithms; onChange: (v: SshAlgorithms) => void }) {
  const toggle = (kind: SshAlgorithmKind, algo: string, on: boolean) => {
    const current: string[] = value[kind] ?? [];
    const next = on ? [...current, algo] : current.filter((a) => a !== algo);
    const out: Record<string, string[]> = { ...value } as Record<string, string[]>;
    if (next.length) out[kind] = next;
    else delete out[kind];
    onChange(out as SshAlgorithms);
  };
  const allSelected = KINDS.every((k) => SSH_LEGACY_ALGORITHMS[k].every((a) => (value[k] as string[] | undefined)?.includes(a)));
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm" data-testid="ssh-algorithms">
      <legend className="section-label px-1">Legacy SSH algorithms (optional)</legend>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Tick only what the OLT firmware asks for, e.g. <code className="font-mono">aes128-cbc</code>. These are appended after the modern algorithms. The <code className="font-mono">ssh-rsa</code> host key works without ticking it.
        </p>
        <Button variant="outline" size="sm" className="h-7 px-2" data-testid="ssh-algorithms-all" onClick={() => onChange(allSelected ? {} : ALL)}>
          {allSelected ? 'Clear all' : 'Select all'}
        </Button>
      </div>
      {KINDS.map((kind) => (
        <div key={kind} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-24 text-xs text-muted-foreground">{LABEL[kind]}</span>
          {SSH_LEGACY_ALGORITHMS[kind].map((algo) => (
            <label key={algo} className="flex items-center gap-1">
              <input
                type="checkbox"
                name={`ssh-${algo}`}
                checked={(value[kind] as string[] | undefined)?.includes(algo) ?? false}
                onChange={(e) => toggle(kind, algo, e.target.checked)}
                className="size-3.5 accent-primary"
              />
              <code className="font-mono text-xs">{algo}</code>
            </label>
          ))}
        </div>
      ))}
    </fieldset>
  );
}
