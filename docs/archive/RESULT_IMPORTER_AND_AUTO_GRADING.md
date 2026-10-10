# Result Importer + 5M/10M Auto-Grading - Reducing Faculty Manual Time by 70%

## 1. Result Importer - University Results (BCU, BNU, Davangere, Rani Channamma)

### Problem with Manual Entry
- Admin manually enters each student's subject marks via GradeRecords page (1 by 1)
- For 100 students × 6 subjects = 600 manual entries, ~5 min each = 50 hours
- Errors: wrong regNo, wrong total, wrong grade, missing SGPA
- No bulk verification of BCU pass criteria (35% external + 40% aggregate)

### Solution: Bulk Excel Importer

#### Files
- `src/modules/admin/types/resultImport.ts` - Types, template headers, sample rows
- `src/modules/admin/api/resultImportApi.ts` - Parse Excel/CSV, group by student, auto-calc SGPA, import to Firestore
- `src/modules/admin/pages/ResultImporter.tsx` - UI with 3 tabs

#### How It Works

**Step 1: Parse Excel**
- Uses `@e965/xlsx` (already in project for curriculum template)
- Reads first sheet, header row case-insensitive, supports aliases:
  - regNo: usn, registrationno, registrationnumber
  - subjectCode: code, coursecode
  - internal: ia, internalmarks
  - external: university, ue, externalmarks
- Validates: regNo + subjectCode required, marks range (internal 0-20, external 0-80 per BCU), total 0-100
- Warnings: Fail per BCU pass check, grade mismatch

**Step 2: Group by Student + Auto SGPA**
- `groupResultsByStudent()` groups rows by regNo
- For each subject:
  - Auto-calc total = internal + external if total missing
  - Auto-grade: `getGradeFromMarks(total)` → O=10 (90-100%), A+=9 (80-89%), A=8 (70-79%), B+=7 (60-69%), B=6 (50-59%), C=5 (40-49%), P=4 (35-39%), F=0
  - BCU pass check: `checkBCUPassCriteria({universityMarks: external, internalMarks: internal})` → 35% in external (28/80) + 40% aggregate
  - Result P/F per subject
- For student:
  - totalMarks, maxTotalMarks, percentage
  - SGPA = Σ(credits × gradePoint) / Σcredits via `calculateSGPA()`
  - creditsEarned = sum of passed subjects credits
  - Result: PASS (0 fails), ATKT (1-2 fails per BCU), FAIL (3+ fails)

**Step 3: Import to Firestore**
- Finds student by regNo → usn → registrationNumber (3 tries)
- Batch write (400 ops per batch, Firestore limit 500):
  - For each subject: create/update in `colleges/{id}/gradeRecords` (official transcript) with status published
  - Create in `colleges/{id}/universityResults` (detailed result)
  - Update student doc: sgpa, cgpa, percentage, resultStatus, lastResultSyncAt
- Returns: imported, updated, failed, errors (student not found etc)

**UI Features**
- Config: academicYear (2024-25), examType (regular/supplementary/revaluation), scheme (SEP 2024)
- Upload: Excel/CSV, shows file name + parsing loader
- Preview Tab:
  - Stats: uniqueStudents, totalSubjects, pass %, avg marks, errors, warnings
  - Grade distribution: O: 5, A+: 10 etc
  - Errors list (row number + message)
  - Student-wise table: regNo, subjects count, total, %, SGPA, result (PASS/ATKT/FAIL) - first 20
  - Import button: "Import X Students - Auto Publish Grade Records"
- History Tab: placeholder for previous imports
- Template download: `bcu_result_import_template.csv` with sample rows

**Time Saved**
- Manual: 600 entries × 5 min = 3000 min = 50 hours for 100 students × 6 subjects
- Importer: Upload + preview + import = 5 min
- **99% time saved**

**Template Format**
```
regNo,name,semester,subjectCode,subjectName,credits,internal,external,total,grade,gradePoint,result,course,batch,sgpa
BCU2024BCA001,Ramesh Kumar,3,BCA301,Data Structures,4,18,65,83,A+,9,P,BCA,2024-25,8.5
BCU2024BCA001,Ramesh Kumar,3,BCA302,DBMS,4,16,58,74,A,8,P,BCA,2024-25,8.5
```

---

## 2. 5 Marks & 10 Marks Auto-Grading - Reduce Faculty Manual Review Time by 70%

### Problem
- BCU descriptive papers: 5M questions (definition, difference, short note, problem) and 10M questions (essay, detailed problem, case study, diagram/program)
- Faculty manually reads each answer: 5M takes ~75 sec, 10M takes ~150 sec
- For 100 students × 5 questions (2×5M + 3×10M) = 100 × (2×1.25 + 3×2.5) = 100 × 10 min = 1000 min = 16.6 hours per exam
- No rubric, inconsistent marking, no keyword check, no bulk grouping

### Solution: Rubric-Based + AI-Assisted + Bulk Grading

#### Files
- `src/shared/utils/autoGrading.ts` - Rubrics, presets, autoGradeAnswer(), groupSimilarAnswers(), calculateTimeSaved()
- `src/modules/faculty/pages/FacultyAutoGrading.tsx` - Dedicated UI for 5M/10M auto-grading
- `src/modules/faculty/components/AssessmentGradingQueue.tsx` - Enhanced with 5/10M presets + auto button

#### Rubrics - Pre-defined for BCU SEP 2024

**5 Marks (4 rubrics):**
1. **Definition + Explanation (5M):** Definition 2M (key terms) + Explanation 2M + Example/Diagram 1M
   - Keywords: define, means, is, explain, because, therefore, example, e.g., diagram
2. **Difference Between (5M):** Concept1 1.5M + Concept2 1.5M + Differences 2M (3 differences)
   - Keywords: difference, whereas, while, but, however
3. **Short Note (5M):** Intro 1M + Main Points 3M (3-4 points) + Conclusion 1M
   - Keywords: important, key, main, feature, advantage
4. **Problem Solving (5M):** Formula 1M + Steps 3M + Final Answer 1M

**10 Marks (4 rubrics):**
1. **Essay Type (10M):** Intro 2M + Body Part1 3M (3-4 points) + Body Part2 3M (examples, case) + Conclusion 2M
   - Model: Intro with definition + 6-8 points + examples + conclusion with application
2. **Detailed Problem (10M):** Understanding 2M + Formulae 2M + Calc Part1 2.5M + Calc Part2 2.5M + Final Answer 1M
3. **Case Study (10M):** Problem ID 2M + Analysis 4M + Solution 3M + Conclusion 1M
4. **Diagram/Program (10M):** Correctness 5M + Labeling/Comments 2M + Explanation 3M

#### Quick Presets - One Click Grading

**5 Marks Presets:**
- 0 - No attempt (rose)
- 1 - Attempted (amber)
- 2 - Partial (amber)
- 3 - Average (blue)
- 4 - Good (teal)
- 5 - Excellent (emerald)

**10 Marks Presets:**
- 0 - No attempt
- 2 - Poor
- 4 - Below Avg
- 5 - Average
- 6 - Above Avg
- 8 - Good
- 10 - Excellent

**For other marks (e.g., 2M, 3M):** 0, half, full

#### Auto-Grading Logic - `autoGradeAnswer(answer, maxMarks, rubric)`

**Inputs:** Student answer text, maxMarks (5|10), rubric, optional modelAnswer

**Steps:**
1. **Empty check:** If answer <10 chars → 0 marks, 95% confidence, no review needed
2. **Keyword matching:** 
   - All keywords from rubric criteria + rubric.keywords
   - Unique, case-insensitive matching
   - keywordScore = matched / total
3. **Length scoring:**
   - Expected: 5M=120 words, 10M=250 words
   - lengthScore = min(1, wordCount / expected)
   - Penalty if <30% expected: 0.5
4. **Structure scoring:** Has paragraphs, bullets (•,-), numbered points (\d\.) → +0.2
5. **Per criterion:**
   - If criterion keywords matched → awarded = maxMarks × (0.6 + keywordScore×0.4) × lengthPenalty + structure bonus
   - Else if wordCount >50% expected → 0.3× maxMarks × lengthPenalty (partial)
   - Rounded to 0.5, capped to maxMarks
6. **Total:** Sum of criteria, capped to maxMarks, rounded to 0.5
7. **Confidence:** 0.5 + keywordScore×0.3 + lengthScore×0.2 + (hasStructure?0.1:0), capped 0.95
8. **Needs Manual Review:** If confidence <0.7 or suggestedMarks <40% max or wordCount <40% expected
9. **Feedback:** Based on marks ratio + matched/missing keywords + word count
10. **Time Saved:** Manual 75 sec (5M) / 150 sec (10M), auto 15 sec if no review, 50% if needs review

**Returns:** AutoGradingResult with suggestedMarks, confidence, breakdown per criterion (awarded/max, feedback, matched), overallFeedback, keywordsMatched, keywordsMissing, needsManualReview, gradingMode, timeSaved

#### Bulk Grading - `groupSimilarAnswers()`

- Groups similar answers by word overlap (Jaccard similarity)
- Threshold 0.7 default: intersection/union of words >3 chars
- Only groups same questionId
- Returns groups with pattern, sample, count, studentIds, suggestedMarks
- Faculty grades one, applies to all in group → massive saver for 100+ students with copy-paste answers

#### Time Saved Calculator - `calculateTimeSaved()`

- Inputs: totalSubmissions, fiveMarksCount, tenMarksCount, autoGradedPercentage (0.7 default)
- Manual: 5M=1.25 min, 10M=2.5 min per submission
- Auto: 70% auto (0.25 min each) + 30% manual review (50% time)
- Returns: manualTimeMinutes, autoTimeMinutes, savedMinutes, savedHours, percentageSaved

**Example:** 100 students × 5 Qs (2×5M + 3×10M)
- Manual: 100×(2×1.25 + 3×2.5)=100×10=1000 min=16.6 hrs
- Auto: 70% auto + 30% review = ~300 min=5 hrs
- Saved: 700 min=11.6 hrs = 70% saved

#### UI - FacultyAutoGrading.tsx

**Header:** Auto-Grading 5M & 10M, Reduce faculty time by 70%

**Time Saved Banner:** Gradient teal→emerald, shows saved hours, manual vs auto time, percentage, 3 cards (5M 75→15 sec 80% saved, 10M 150→30 sec, bulk groups), Auto-Grade All button

**Rubric Selector:** 2 columns - 5M rubrics (4) and 10M rubrics (4), each button shows title, description, criteria badges (label: maxM), selected highlighted teal. Below shows selected rubric details + model answer.

**Grading Queue:** 3 columns - left submissions list (1/3), right detail (2/3)

**Submissions List:**
- Each card: student name, regNo mono, question text line-clamp 2, 5M/10M badge amber/blue, subject, 10×10 marks badge (emerald if auto-graded, amber if needs review, slate if not graded), confidence % color (emerald >80%, amber >60%, rose <60%), needs review badge + time saved

**Grading Detail (when selected):**
- Question card: question text, subject, marks badge
- Answer card: student answer pre-wrap, word count
- If auto-graded:
  - Result card: amber if needs review, emerald if auto, shows confidence, marks / max, 3 stats (confidence %, time saved sec, keywords matched), overall feedback, breakdown by rubric (each criterion with matched/missing badge + awarded/max), matched keywords + missing keywords
  - Quick presets: 5M 0-5 or 10M 0,2,4,5,6,8,10 grid, selected teal, one click override
  - Actions: Accept & Publish (teal), Edit Marks
- If not graded:
  - Auto-Grade button (gradient teal→emerald, brain icon)
  - 2 info cards: How it works 5M (definition 2+explanation 2+example 1, keyword+word count, 75→15 sec) and 10M (intro 2+body 6+conclusion 2, structure+examples, 150→30 sec)

**Bulk Groups:** If groups found, shows pattern, sample, count, studentIds, Grade All button

**Time Saved Calculator:** 3 columns - Manual (5M×Qs×students, 10M×Qs×students, total), Auto (70% auto, 30% review, total), Saved (hours, %, for 100 students ×5 Qs save ~X hrs), faculty benefits list

#### Enhanced AssessmentGradingQueue.tsx

- Added import for FIVE_MARKS_PRESETS, TEN_MARKS_PRESETS, autoGradeAnswer, rubrics
- Added getQuickPresets(maxMarks) → returns 5M presets if 5, 10M presets if 10, else 0/half/full
- Added getRubricForMarks(maxMarks)
- Enhanced per-question rendering:
  - Before: 3 buttons 0, half, full + number input
  - Now: For 5M/10M shows all presets (0-5 for 5M, 0,2,4,5,6,8,10 for 10M) as small buttons with color (rose/amber/blue/teal/emerald), plus Auto button (brain icon) that auto-grades that question using rubric
  - One click grading: 5 sec vs 75-150 sec

---

## Integration with Existing System

- **AssessmentGradingQueue** already had AI suggestion via `suggestAssessmentGrading` callable (Gemini/OpenAI/DeepSeek). Now also has local rubric-based auto-grading for instant feedback without API call.
- **GradeRecords** page now gets data from result importer (auto published)
- **Exam Management** hall tickets use attendance eligibility which uses BCU compliance utils

---

## Testing

### Result Importer
1. Download template CSV from UI
2. Fill with BCU data: regNo, subjectCode, internal, external, total, credits, grade, result
3. Upload → Preview shows uniqueStudents, pass %, avg marks, grade distribution, errors
4. Check student-wise table: total, %, SGPA, result PASS/ATKT/FAIL
5. Import → Firestore gradeRecords + universityResults + student sgpa updated
6. Verify GradeRecords page shows imported records as published

### Auto-Grading
1. Go to Faculty → Auto-Grading 5M/10M
2. Select rubric (e.g., Definition + Explanation 5M)
3. Click Auto-Grade All → see confidence, marks, time saved
4. Click submission → see breakdown, keywords matched/missing, quick presets
5. Click preset 5M=4 → overrides AI suggestion instantly
6. Check time saved calculator: manual vs auto hours
7. Go to Faculty → Assessments → Manual grading tab → per-question now shows 5M/10M presets + Auto button

---

## Future Enhancements

- **AI Model Integration:** Call Gemini/OpenAI for deeper semantic grading (currently keyword-based, fast but less accurate than LLM)
- **Model Answer Comparison:** Cosine similarity with model answer embedding
- **Handwriting OCR:** For scanned answer sheets
- **Bulk Apply:** Grade all in bulk group with one click
- **Analytics:** Faculty time saved dashboard, grading consistency
- **Student Feedback:** Show rubric breakdown to student in result page
