import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateCollege, useSystemConfig, useCollege, useUpdateCollege } from '../hooks/useSuperAdmin'
import { useNotification } from '../../../shared/providers/NotificationProvider'
import { Building2, ArrowLeft, Save, Loader2, Globe, MapPin, Phone, Mail } from 'lucide-react'
import type { PlanType } from '../types/superAdmin'
import { listBranchRegistry } from '../api/branchRegistryApi'
import type { BranchRegistryEntry } from '../../../shared/utils/branchRegistry'

interface FormData {
  name: string
  code: string
  shortName: string
  address: string
  city: string
  state: string
  country: string
  location: string
  phone: string
  email: string
  website: string
  plan: PlanType
  assignedBranchIds: number[]
  currentStudents: number
  currentFaculty: number
  courses: number
}

interface CreateCollegeProps {
  /** When provided, the form loads and edits this college instead of creating one. */
  collegeId?: string
}

const initialFormData: FormData = {
  name: '',
  code: '',
  shortName: '',
  address: '',
  city: '',
  state: '',
  country: 'India',
  location: '',
  phone: '',
  email: '',
  website: '',
  plan: 'standard',
  assignedBranchIds: [],
  currentStudents: 0,
  currentFaculty: 0,
  courses: 0,
}

const CreateCollege: React.FC<CreateCollegeProps> = ({ collegeId }) => {
  const navigate = useNavigate()
  const { showSuccess, showError } = useNotification()
  const createCollege = useCreateCollege()
  const updateCollege = useUpdateCollege()
  const systemConfig = useSystemConfig()
  const isEdit = Boolean(collegeId)
  const collegeQuery = useCollege(isEdit ? collegeId : null)
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({})
  const [prefilled, setPrefilled] = useState(false)
  const [registry, setRegistry] = useState<BranchRegistryEntry[]>([])
  const [registryLoading, setRegistryLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    listBranchRegistry()
      .then((list) => { if (!cancelled) setRegistry(list) })
      .catch(() => { if (!cancelled) setRegistry([]) })
      .finally(() => { if (!cancelled) setRegistryLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Prefill the form once the existing college loads (edit mode only).
  useEffect(() => {
    if (!isEdit || prefilled) return
    const c = collegeQuery.data
    if (!c) return
    setFormData({
      name: c.name || '',
      code: c.code || '',
      shortName: c.shortName || '',
      address: c.address || '',
      city: c.city || '',
      state: c.state || '',
      country: c.country || 'India',
      location: c.location || '',
      phone: c.phone || '',
      email: c.email || '',
      website: c.website || '',
      plan: (c.plan as PlanType) || 'standard',
      assignedBranchIds: c.assignedBranchIds ?? [],
      currentStudents: c.currentStudents ?? 0,
      currentFaculty: c.currentFaculty ?? 0,
      courses: c.courses ?? 0,
    })
    setPrefilled(true)
  }, [isEdit, prefilled, collegeQuery.data])

  const toggleBranch = (branchId: number) => {
    setFormData(prev => ({
      ...prev,
      assignedBranchIds: prev.assignedBranchIds.includes(branchId)
        ? prev.assignedBranchIds.filter(id => id !== branchId)
        : [...prev.assignedBranchIds, branchId].sort((a, b) => a - b),
    }))
    if (errors.assignedBranchIds) setErrors(prev => ({ ...prev, assignedBranchIds: undefined }))
  }

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}
    if (!formData.name.trim()) newErrors.name = 'College name is required'
    if (!formData.code.trim()) newErrors.code = 'College code is required'
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Enter a valid email address'
    }
    if (formData.phone && !/^\d{10}$/.test(formData.phone.replace(/\D/g, ''))) {
      newErrors.phone = 'Enter a valid 10-digit phone number'
    }
    // Creating a college needs at least one branch. Existing colleges are edited as before.
    if (!isEdit && formData.assignedBranchIds.length === 0) {
      newErrors.assignedBranchIds = 'Assign at least one branch'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? (parseInt(value) || 0) : value,
    }))
    if (errors[name as keyof FormData]) {
      setErrors(prev => ({ ...prev, [name]: undefined }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Onboarding toggle only gates CREATION, not editing an existing college.
    if (!isEdit && systemConfig.data && !systemConfig.data.allowCollegeOnboarding) {
      showError('College onboarding is disabled in System Management.')
      return
    }
    if (!validateForm()) return

    const payload = {
      name: formData.name.trim(),
      code: formData.code.trim(),
      shortName: formData.shortName.trim(),
      address: formData.address.trim(),
      city: formData.city.trim(),
      state: formData.state.trim(),
      country: formData.country.trim(),
      location: formData.location.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim(),
      website: formData.website.trim(),
      plan: formData.plan,
      currentStudents: formData.currentStudents,
      currentFaculty: formData.currentFaculty,
      courses: formData.courses,
      assignedBranchIds: formData.assignedBranchIds,
    }

    try {
      if (isEdit && collegeId) {
        await updateCollege.mutateAsync({ collegeId, updates: payload })
        showSuccess(`College "${payload.name}" updated successfully!`)
        navigate(`/superadmin/colleges/${collegeId}`)
      } else {
        await createCollege.mutateAsync(payload)
        showSuccess(`College "${payload.name}" created successfully!`)
        navigate('/superadmin/colleges')
      }
    } catch (err: any) {
      showError(err?.message || (isEdit ? 'Failed to update college' : 'Failed to create college'))
    }
  }

  // Edit-mode guards: loading, then not-found.
  if (isEdit && collegeQuery.isLoading) {
    return (
      <div className="page-container flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500 dark:text-slate-400" />
      </div>
    )
  }
  if (isEdit && !collegeQuery.isLoading && !collegeQuery.data) {
    return (
      <div className="page-container">
        <p className="text-slate-600 dark:text-slate-400">College not found.</p>
        <button onClick={() => navigate('/superadmin/colleges')} className="mt-3 text-teal-600 hover:underline text-sm">
          Back to colleges
        </button>
      </div>
    )
  }

  const submitting = isEdit ? updateCollege.isPending : createCollege.isPending

  const inputClasses = (fieldName: keyof FormData) =>
    `w-full px-4 py-2.5 bg-white dark:bg-slate-800 border rounded-lg text-sm text-slate-900 dark:text-white transition-colors
     focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent
     placeholder-slate-400 dark:placeholder-slate-500
     ${errors[fieldName] ? 'border-red-500 bg-red-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'}`

  const labelClasses = 'block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5'
  const requiredMark = <span className="text-red-600 dark:text-red-400">*</span>

  return (
    <div className="page-container">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-500 dark:text-slate-400" />
        </button>
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Building2 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{isEdit ? 'Edit College' : 'Create College'}</h1>
          </div>
          <p className="text-slate-600 dark:text-slate-400 text-sm">{isEdit ? 'Update this institution\u2019s details' : 'Register a new college in the system'}</p>
        </div>
      </div>

      {!isEdit && systemConfig.data && !systemConfig.data.allowCollegeOnboarding && (
        <div className="mb-6 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          College onboarding is currently disabled from System Management. Re-enable it there before creating an institution.
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-3xl space-y-6">
        {/* Basic Information */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className={labelClasses}>College Name {requiredMark}</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className={inputClasses('name')}
                placeholder="e.g., Vriddhi Academics Demo College"
              />
              {errors.name && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.name}</p>}
            </div>

            <div>
              <label className={labelClasses}>College Code {requiredMark}</label>
              <input
                type="text"
                name="code"
                value={formData.code}
                onChange={handleChange}
                className={inputClasses('code')}
                placeholder="e.g., VA-001"
              />
              {errors.code && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.code}</p>}
            </div>

            <div>
              <label className={labelClasses}>Short Name</label>
              <input
                type="text"
                name="shortName"
                value={formData.shortName}
                onChange={handleChange}
                className={inputClasses('shortName')}
                placeholder="e.g., VADC"
              />
            </div>

            <div>
              <label className={labelClasses}>Plan</label>
              <select
                name="plan"
                value={formData.plan}
                onChange={handleChange}
                className={`${inputClasses('plan')} appearance-none`}
              >
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
                <option value="pro">Pro</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className={labelClasses}>Branches offered</label>
              {registryLoading ? (
                <p className="text-sm text-slate-500">Loading branches…</p>
              ) : registry.length === 0 ? (
                <p className="text-sm text-slate-500">No branches yet. Add them on the Branches page first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {registry.map((b) => {
                    const on = formData.assignedBranchIds.includes(b.branchId)
                    return (
                      <button
                        key={b.branchId}
                        type="button"
                        onClick={() => toggleBranch(b.branchId)}
                        className={`px-3 py-1.5 rounded-lg text-sm border ${on ? 'bg-teal-600 text-white border-teal-600' : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300'}`}
                      >
                        <span className="font-mono text-xs mr-1">{b.branchId}</span>{b.name}
                      </button>
                    )
                  })}
                </div>
              )}
              {errors.assignedBranchIds && <p className="text-xs text-red-600 mt-1">{errors.assignedBranchIds}</p>}
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Contact Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClasses}>
                <Mail className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className={inputClasses('email')}
                placeholder="college@example.edu"
              />
              {errors.email && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.email}</p>}
            </div>

            <div>
              <label className={labelClasses}>
                <Phone className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Phone
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className={inputClasses('phone')}
                placeholder="10-digit phone number"
              />
              {errors.phone && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{errors.phone}</p>}
            </div>

            <div className="md:col-span-2">
              <label className={labelClasses}>
                <Globe className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Website
              </label>
              <input
                type="text"
                name="website"
                value={formData.website}
                onChange={handleChange}
                className={inputClasses('website')}
                placeholder="www.example.edu"
              />
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2">
              <label className={labelClasses}>
                <MapPin className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                Address
              </label>
              <textarea
                name="address"
                value={formData.address}
                onChange={handleChange}
                className={`${inputClasses('address')} resize-none h-20`}
                placeholder="Full address"
              />
            </div>

            <div>
              <label className={labelClasses}>City</label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                className={inputClasses('city')}
                placeholder="e.g., Mysore"
              />
            </div>

            <div>
              <label className={labelClasses}>State</label>
              <input
                type="text"
                name="state"
                value={formData.state}
                onChange={handleChange}
                className={inputClasses('state')}
                placeholder="e.g., Karnataka"
              />
            </div>

            <div>
              <label className={labelClasses}>Country</label>
              <input
                type="text"
                name="country"
                value={formData.country}
                onChange={handleChange}
                className={inputClasses('country')}
                placeholder="e.g., India"
              />
            </div>

            <div>
              <label className={labelClasses}>Location (Display)</label>
              <input
                type="text"
                name="location"
                value={formData.location}
                onChange={handleChange}
                className={inputClasses('location')}
                placeholder="e.g., Mysore, Karnataka"
              />
            </div>
          </div>
        </div>

        {/* Initial Counts */}
        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Initial Counts (Optional)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <label className={labelClasses}>Current Students</label>
              <input
                type="number"
                name="currentStudents"
                value={formData.currentStudents}
                onChange={handleChange}
                className={inputClasses('currentStudents')}
                placeholder="0"
                min={0}
              />
            </div>
            <div>
              <label className={labelClasses}>Current Faculty</label>
              <input
                type="number"
                name="currentFaculty"
                value={formData.currentFaculty}
                onChange={handleChange}
                className={inputClasses('currentFaculty')}
                placeholder="0"
                min={0}
              />
            </div>
            <div>
              <label className={labelClasses}>Courses</label>
              <input
                type="number"
                name="courses"
                value={formData.courses}
                onChange={handleChange}
                className={inputClasses('courses')}
                placeholder="0"
                min={0}
              />
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="flex items-center justify-end gap-4 pt-4">
          <button
            type="button"
            onClick={() => {
              setFormData(initialFormData)
              setErrors({})
            }}
            className="px-6 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={submitting || systemConfig.isLoading || (!isEdit && systemConfig.data?.allowCollegeOnboarding === false)}
            className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-slate-900 dark:text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {isEdit ? 'Saving...' : 'Creating...'}
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {isEdit ? 'Save Changes' : 'Create College'}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

export default CreateCollege