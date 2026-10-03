import React, { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { DEFAULT_PROGRAMS } from '@/shared/constants/academicPrograms'

interface BranchMultiInputProps {
  value: string[]
  onChange: (branches: string[]) => void
  label?: string
  helpText?: string
  disabled?: boolean
  required?: boolean
  suggestions?: string[]
}

const normalize = (values: string[]) => Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

export default function BranchMultiInput({
  value,
  onChange,
  label = 'Branches / programs',
  helpText = 'Type a branch and press Enter. The first is the primary branch; click another branch name to make it primary.',
  disabled = false,
  required = false,
  suggestions = DEFAULT_PROGRAMS,
}: BranchMultiInputProps) {
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const listId = `${inputId}-options`

  const addDraft = () => {
    const candidates = draft.split(',').map((item) => item.trim()).filter(Boolean)
    if (candidates.length === 0) return
    onChange(normalize([...value, ...candidates]))
    setDraft('')
  }

  return (
    <div>
      <label htmlFor={inputId} className="block text-sm text-slate-700 dark:text-slate-300 mb-1">
        {label}{required ? ' *' : ''}
      </label>
      <div className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 focus-within:ring-2 focus-within:ring-teal-500/30 focus-within:border-teal-500">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {value.map((branch, index) => (
              <span
                key={branch}
                className="inline-flex items-center gap-1 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200 px-2.5 py-1 text-xs"
              >
                {index === 0 ? (
                  <><span className="font-semibold">Primary:</span> {branch}</>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange([branch, ...value.filter((item) => item !== branch)])}
                    className="hover:underline disabled:no-underline"
                    title={`Make ${branch} the primary branch`}
                  >
                    {branch}
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(value.filter((item) => item !== branch))}
                  className="ml-0.5 rounded-full hover:bg-teal-200 dark:hover:bg-teal-800 disabled:opacity-50"
                  aria-label={`Remove ${branch}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            list={listId}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ',') {
                event.preventDefault()
                addDraft()
              }
            }}
            onBlur={addDraft}
            placeholder={value.length ? 'Add another branch' : 'e.g. ECE, EEE, MECH, CIVIL, CSE (AI & ML), CSE (DS), BCA'}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            disabled={disabled || !draft.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={addDraft}
            className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>
      <datalist id={listId}>
        {suggestions.filter((item) => !value.includes(item)).map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      {helpText && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{helpText}</p>}
    </div>
  )
}

