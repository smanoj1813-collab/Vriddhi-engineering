import { useState, useRef, useMemo, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ChevronLeft, Upload, FileText, Video, Link2, X, Check,
  File, Trash2, Download, Eye, FolderOpen, Search, FileUp,
  BookOpen, Users, RefreshCw, Loader2, AlertTriangle, ExternalLink,
  Sparkles, Layers
} from 'lucide-react'
import { useAuth } from '@/modules/auth/context/AuthContext'
import { useMaterials } from '../../../hooks/useMaterials'
import { useFacultyCurriculum } from '../hooks/useFacultyCurriculum'
import type { MaterialType } from '../../../api/materialApi'
import { useNotification } from '../../../shared/providers/NotificationProvider'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '@/Firebase/config'
import { extractCanonicalSubject, extractCanonicalTopic } from '@/shared/utils/curriculumMatcher'

const TYPE_LABELS: Record<MaterialType, string> = {
  pdf: 'PDF',
  video: 'VIDEO',
  link: 'LINK',
  image: 'IMAGE',
  document: 'DOC',
  presentation: 'PPT',
}

const typeIcons: Record<MaterialType, React.ReactNode> = {
  pdf: <FileText className="w-5 h-5 text-rose-400" />,
  video: <Video className="w-5 h-5 text-purple-400" />,
  link: <Link2 className="w-5 h-5 text-blue-400" />,
  image: <File className="w-5 h-5 text-green-400" />,
  document: <File className="w-5 h-5 text-blue-400" />,
  presentation: <File className="w-5 h-5 text-orange-400" />,
}

const typeColors: Record<MaterialType, string> = {
  pdf: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  video: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  link: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  image: 'bg-green-500/10 text-green-400 border-green-500/20',
  document: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  presentation: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
}

export default function FacultyUploadMaterial() {
  const { user } = useAuth()
  const facultyId = user?.id || user?.uid || ''
  const collegeId = user?.collegeId || ''

  const {
    materials, stats, loading, error, readStats,
    search, setSearch,
    filterType, setFilterType,
    refresh,
    addMaterial, removeMaterial, trackView, trackDownload,
  } = useMaterials()

  const { curriculum, loading: curriculumLoading } = useFacultyCurriculum(facultyId, collegeId)
  const { showError, showSuccess } = useNotification()

  const [showModal, setShowModal] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Form Fields
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadType, setUploadType] = useState<MaterialType>('pdf')
  const [uploadUrl, setUploadUrl] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  // Dynamic Curriculum Linkage
  const [selectedCourseId, setSelectedCourseId] = useState<string>('')
  const [selectedModuleId, setSelectedModuleId] = useState<string>('')
  const [selectedTopic, setSelectedTopic] = useState<string>('')
  const [customSubject, setCustomSubject] = useState<string>('')
  const [customTopic, setCustomTopic] = useState<string>('')

  // Set default course when curriculum loads
  useEffect(() => {
    if (curriculum && curriculum.length > 0 && !selectedCourseId) {
      setSelectedCourseId(curriculum[0].courseId)
    }
  }, [curriculum, selectedCourseId])

  const selectedCourse = useMemo(() => {
    return curriculum.find(c => c.courseId === selectedCourseId)
  }, [curriculum, selectedCourseId])

  const availableModules = useMemo(() => {
    return selectedCourse?.modules || []
  }, [selectedCourse])

  const selectedModule = useMemo(() => {
    return availableModules.find(m => m.id === selectedModuleId || String(m.moduleNo) === selectedModuleId)
  }, [availableModules, selectedModuleId])

  const availableTopics = useMemo(() => {
    return selectedModule?.topics || []
  }, [selectedModule])

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      setSelectedFile(files[0])
      setUploadTitle(files[0].name.replace(/\.[^/.]+$/, ''))
      const ext = files[0].name.split('.').pop()?.toLowerCase()
      if (ext === 'pdf') setUploadType('pdf')
      else if (['doc', 'docx'].includes(ext || '')) setUploadType('document')
      else if (['ppt', 'pptx'].includes(ext || '')) setUploadType('presentation')
      else if (['mp4', 'mov', 'avi', 'mkv'].includes(ext || '')) setUploadType('video')
      else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) setUploadType('image')
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
    }
  }

  // Per-type client caps — must stay at or below the server caps in
  // storage.rules (50 MB hard cap on /colleges/{id}/materials/).
  const MATERIAL_SIZE_LIMITS: Record<MaterialType, number> = {
    pdf: 25 * 1024 * 1024,
    document: 25 * 1024 * 1024,
    presentation: 25 * 1024 * 1024,
    image: 15 * 1024 * 1024,
    video: 50 * 1024 * 1024,
    link: 0,
  }

  // Last-resort escape hatch: if Storage is unreachable, embed tiny files as a
  // data URL in the Firestore doc. Base64 inflates size ~33% and Firestore
  // documents hard-cap at 1 MiB, so only files up to 300 KB can ever fit.
  // Anything larger MUST fail with a visible error — the old behaviour was to
  // base64 everything, which silently broke every upload over ~700 KB.
  const BASE64_FALLBACK_MAX_BYTES = 300 * 1024

  const uploadFileToStorage = async (file: File): Promise<{ url: string; storagePath: string | null }> => {
    const limit = MATERIAL_SIZE_LIMITS[uploadType]
    if (limit > 0 && file.size > limit) {
      throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit for ${uploadType} materials is ${Math.round(limit / 1024 / 1024)} MB.`)
    }
    if (file.size < 1) {
      throw new Error('The selected file is empty.')
    }
    try {
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const storagePath = `colleges/${collegeId}/materials/${Date.now()}_${sanitizedName}`
      const storageRef = ref(storage, storagePath)
      await uploadBytes(storageRef, file, { contentType: file.type })
      return { url: await getDownloadURL(storageRef), storagePath }
    } catch (storageErr) {
      if (file.size <= BASE64_FALLBACK_MAX_BYTES) {
        console.warn('[FacultyUploadMaterial] Cloud Storage upload failed, storing small file as base64 data URL:', storageErr)
        return new Promise((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve({ url: reader.result as string, storagePath: null })
          reader.readAsDataURL(file)
        })
      }
      console.error('[FacultyUploadMaterial] Cloud Storage upload failed and file is too large for the fallback:', storageErr)
      throw new Error('Cloud Storage upload failed. The file is too large to fall back to in-database storage — please retry, or share the file via an external link instead.')
    }
  }

  const confirmUpload = async () => {
    if (!uploadTitle.trim()) {
      setModalError('Title is required')
      return
    }
    if (uploadType !== 'link' && !selectedFile) {
      setModalError('Please select a file to upload')
      return
    }
    if (uploadType === 'link' && !uploadUrl.trim()) {
      setModalError('URL is required for link type')
      return
    }

    setUploading(true)
    setModalError(null)

    try {
      let finalUrl = uploadUrl.trim()
      let storagePath: string | undefined
      let fileSizeStr: string | undefined

      if (selectedFile) {
        const uploaded = await uploadFileToStorage(selectedFile)
        finalUrl = uploaded.url
        storagePath = uploaded.storagePath ?? undefined
        fileSizeStr = `${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB`
      }

      const subjectName = selectedCourse ? selectedCourse.courseName : customSubject.trim() || 'General'
      const courseCode = selectedCourse?.courseCode || ''
      const topicName = selectedTopic ? selectedTopic : customTopic.trim() || selectedModule?.title || 'General'

      await addMaterial({
        title: uploadTitle.trim(),
        type: uploadType,
        url: finalUrl,
        ...(storagePath ? { storagePath } : {}),
        subject: subjectName,
        courseId: selectedCourse?.courseId || '',
        courseCode: courseCode,
        courseName: subjectName,
        moduleId: selectedModule?.id || '',
        moduleNo: selectedModule?.moduleNo || '',
        moduleName: selectedModule?.title || selectedModule?.moduleName || '',
        topic: topicName,
        batch: selectedCourse?.batch || '',
        branch: selectedCourse?.branch || '',
        semester: selectedCourse?.semester || '',
        size: fileSizeStr,
        tags: [subjectName, topicName, selectedCourse?.branch].filter(Boolean) as string[],
        facultyId,
        facultyName: user?.name || user?.email || 'Faculty',
      })

      showSuccess?.('Course material uploaded and mapped to curriculum!')
      resetModal()
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this material?')) return
    try {
      await removeMaterial(id)
      showSuccess?.('Material removed successfully')
    } catch (err) {
      showError?.(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  // Keep the file URL on the clicked anchor itself. Opening a new tab only
  // after awaiting analytics loses the browser's user-activation gesture, so
  // mobile browsers / installed PWAs block it (most visibly for PDF viewers).
  const handleView = (id: string) => {
    void trackView(id).catch(() => {})
  }

  const handleDownload = (id: string) => {
    void trackDownload(id).catch(() => {})
  }

  const resetModal = () => {
    setShowModal(false)
    setUploadTitle('')
    setSelectedTopic('')
    setUploadUrl('')
    setCustomSubject('')
    setCustomTopic('')
    setSelectedFile(null)
    setUploadType('pdf')
    setModalError(null)
  }

  const statCards = [
    { label: 'Total', value: stats?.total ?? 0, icon: <FolderOpen className="w-5 h-5 text-teal-400" /> },
    { label: 'PDFs', value: stats?.pdf ?? 0, icon: <FileText className="w-5 h-5 text-rose-400" /> },
    { label: 'Videos', value: stats?.video ?? 0, icon: <Video className="w-5 h-5 text-purple-400" /> },
    { label: 'Links', value: stats?.link ?? 0, icon: <Link2 className="w-5 h-5 text-blue-400" /> },
  ]

  const safeReadStats = readStats || { used: 0, remaining: 999 }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto min-h-screen">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Link to="/faculty" className="p-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 hover:bg-teal-500/5 transition-all shadow-sm">
            <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-300" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Upload Course Material</h1>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              Publish lecture slides, reference guides, and videos mapped to your syllabus
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg text-xs font-medium border bg-emerald-500/10 border-emerald-500/30 text-emerald-400">
            {curriculum.length > 0 ? `${curriculum.length} Assigned Courses` : 'General Catalog'}
          </div>
          <button
            onClick={refresh}
            className="p-2 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 text-slate-500 dark:text-slate-400 hover:text-teal-500 dark:hover:text-teal-400 transition-all shadow-sm"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-500 text-white font-medium hover:bg-teal-600 transition-all text-sm shadow-sm"
          >
            <FileUp className="w-4 h-4" />
            Upload New Material
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />{error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {statCards.map((stat, i) => (
          <div key={i} className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-700/30">{stat.icon}</div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">{stat.value}</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search materials by title, course, or topic..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-teal-500/50"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['all', 'pdf', 'video', 'link', 'document', 'presentation'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                filterType === t
                  ? 'bg-teal-500 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Materials List */}
      <div className="space-y-3">
        {loading && materials.length === 0 && (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 text-teal-400 animate-spin mx-auto mb-2" />
            <span className="text-slate-600 dark:text-slate-400 text-sm">Loading course materials...</span>
          </div>
        )}

        {materials.length === 0 && !loading ? (
          <div className="p-12 text-center bg-white dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <FolderOpen className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <p className="text-slate-800 dark:text-slate-200 font-semibold text-sm">No materials uploaded yet</p>
            <p className="text-slate-500 dark:text-slate-400 text-xs mt-1">
              Click &quot;Upload New Material&quot; to publish documents directly to your students&apos; syllabus modules.
            </p>
          </div>
        ) : (
          materials.map(material => (
            <div
              key={material.id}
              className="p-4 rounded-2xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 hover:border-teal-500/30 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={`p-3 rounded-xl shrink-0 ${typeColors[material.type] || 'bg-slate-100 text-slate-600'}`}>
                  {typeIcons[material.type] || <File className="w-5 h-5" />}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {material.title}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
                    <span className="px-2 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-semibold">
                      {material.subject}
                    </span>
                    {material.moduleName && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {material.moduleName}
                      </span>
                    )}
                    {material.topic && material.topic !== 'General' && (
                      <span>• {material.topic}</span>
                    )}
                    {material.size && <span>• {material.size}</span>}
                    {material.uploadedAt && (
                      <span>• {new Date(material.uploadedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end md:self-auto">
                {material.type === 'link' ? (
                  <a
                    href={material.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleView(material.id)}
                    className="p-2 rounded-xl bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all"
                    title="Open Link"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                ) : material.url && material.url !== '#' ? (
                  <a
                    href={material.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleDownload(material.id)}
                    className="p-2 rounded-xl bg-teal-500/10 text-teal-500 hover:bg-teal-500/20 transition-all"
                    title="Download / View"
                    aria-label="Open or download material"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="p-2 rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800"
                    title="No file is available"
                    aria-label="No file is available"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => handleDelete(material.id)}
                  className="p-2 rounded-xl bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Upload Modal Connected to Curriculum */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl p-6 max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-xl bg-teal-500/10 text-teal-400 shrink-0">
                  <FileUp className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Upload Syllabus Material</h2>
                  <p className="text-xs text-slate-500">Automatically linked to students&apos; assigned curriculum</p>
                </div>
              </div>
              <button onClick={resetModal} className="p-1.5 shrink-0 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            {/* Type Selector */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {(['pdf', 'video', 'link', 'image', 'document', 'presentation'] as MaterialType[]).map(type => (
                <button
                  key={type}
                  onClick={() => setUploadType(type)}
                  className={`flex-1 min-w-[70px] py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                    uploadType === type
                      ? 'bg-teal-500 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {typeIcons[type]}
                  {TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {/* File Drop Zone */}
              {uploadType !== 'link' && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-teal-500 bg-teal-500/10'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50 dark:bg-slate-800/40'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileSelect}
                    accept={
                      uploadType === 'pdf' ? '.pdf' :
                      uploadType === 'video' ? 'video/*' :
                      uploadType === 'image' ? 'image/*' :
                      uploadType === 'document' ? '.doc,.docx' :
                      '.ppt,.pptx'
                    }
                  />
                  <Upload className="w-8 h-8 text-teal-500 mx-auto mb-2" />
                  <p className="text-sm text-slate-800 dark:text-slate-200 font-semibold">
                    {selectedFile ? selectedFile.name : 'Click to select or drag & drop file'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {uploadType === 'pdf' && 'PDF document up to 25MB'}
                    {uploadType === 'video' && 'Video file up to 50MB (MP4/MOV/WebM)'}
                    {uploadType === 'image' && 'Image file up to 15MB'}
                    {uploadType === 'document' && 'Word document (.doc, .docx) up to 25MB'}
                    {uploadType === 'presentation' && 'PowerPoint (.ppt, .pptx) up to 25MB'}
                  </p>
                </div>
              )}

              {/* URL Input */}
              {uploadType === 'link' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Resource URL *</label>
                  <input
                    type="url"
                    value={uploadUrl}
                    onChange={e => setUploadUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:border-teal-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Material Title *</label>
                <input
                  type="text"
                  value={uploadTitle}
                  onChange={e => setUploadTitle(e.target.value)}
                  placeholder="e.g., Unit 2 - Complete Working Notes with Examples"
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:border-teal-500"
                />
              </div>

              {/* Course Selection (From Real Assigned Curriculum) */}
              <div className="p-3.5 rounded-2xl bg-teal-50/50 dark:bg-teal-950/20 border border-teal-500/20 space-y-3">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-teal-500" />
                  <span className="text-xs font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300">
                    Syllabus Mapping (No Hardcoded Codes)
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Assigned Course</label>
                  <select
                    value={selectedCourseId}
                    onChange={e => {
                      setSelectedCourseId(e.target.value)
                      setSelectedModuleId('')
                      setSelectedTopic('')
                    }}
                    className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs font-medium focus:outline-none focus:border-teal-500"
                  >
                    {curriculum.map(c => (
                      <option key={c.courseId} value={c.courseId}>
                        {c.courseName} {c.courseCode ? `(${c.courseCode})` : ''} — {c.branch} Sem {c.semester}
                      </option>
                    ))}
                    <option value="custom">Other / General College Subject</option>
                  </select>
                </div>

                {selectedCourseId === 'custom' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Subject Name</label>
                    <input
                      type="text"
                      value={customSubject}
                      onChange={e => setCustomSubject(e.target.value)}
                      placeholder="e.g. Cost Accounting"
                      className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-teal-500"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Module / Unit</label>
                      <select
                        value={selectedModuleId}
                        onChange={e => {
                          setSelectedModuleId(e.target.value)
                          setSelectedTopic('')
                        }}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-teal-500"
                      >
                        <option value="">All Modules / General Course Material</option>
                        {availableModules.map(m => (
                          <option key={m.id || String(m.moduleNo)} value={m.id || String(m.moduleNo)}>
                            Module {m.moduleNo}: {m.title || m.moduleName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Specific Topic</label>
                      <select
                        value={selectedTopic}
                        onChange={e => setSelectedTopic(e.target.value)}
                        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white text-xs focus:outline-none focus:border-teal-500"
                      >
                        <option value="">General Module Notes</option>
                        {availableTopics.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={resetModal}
                className="flex-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-all text-xs"
              >
                Cancel
              </button>
              <button
                onClick={confirmUpload}
                disabled={uploading}
                className="flex-1 px-4 py-2.5 rounded-xl bg-teal-500 text-white font-semibold hover:bg-teal-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-xs flex items-center justify-center gap-2 shadow-sm"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {uploading ? 'Uploading & Linking...' : 'Publish to Students'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
