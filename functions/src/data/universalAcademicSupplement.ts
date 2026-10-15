// Student-first concept mastery content for Vriddhi Prep.
//
// This is a supplementary learning layer, not a university syllabus. It is
// intentionally free of semester, university, scheme, and PYQ tags so learners
// from different institutions can use the same explanations and methods.
// The shared study toolkit serves every Prep program; applied subject packs
// add examples for Commerce, Management, Science, and Arts learners.

import type { PrepSubject, PrepTopic, UniversalQuestion } from '../prepShared'

const PUBLISHED_AT = '2026-10-01T00:00:00.000Z'
const ALL_PROGRAMS = ['bba', 'bcom', 'bca', 'bsc', 'ba', 'cse', 'ece', 'eee', 'me', 'cv', 'mba', 'mcom', 'mca']

export const UNIVERSAL_ACADEMIC_SUBJECTS: PrepSubject[] = [
  {
    id: 'universal-study-toolkit',
    name: 'Understand, Solve & Explain: Student Toolkit',
    stream: 'learning',
    programs: ALL_PROGRAMS,
    track: 'academic',
    icon: 'Brain',
    order: 900,
    topicCount: 6,
    status: 'published',
    description: 'Cross-disciplinary methods for decoding questions, building clear answers, choosing a method, checking work, learning actively and improving from mistakes. Designed to sit alongside—not replace—any course curriculum.',
  },
  {
    id: 'universal-commerce-thinking',
    name: 'Commerce Thinking: Accounts, Ratios & Decisions',
    stream: 'commerce',
    programs: ['bcom', 'bba', 'mba', 'mcom'],
    track: 'academic',
    icon: 'ReceiptText',
    order: 901,
    topicCount: 2,
    status: 'published',
    description: 'Build a reliable mental model for accounting transactions and financial ratios, then use it to explain what the numbers mean rather than merely calculate them.',
  },
  {
    id: 'universal-management-cases',
    name: 'Management Cases: From Situation to Decision',
    stream: 'management',
    programs: ['bba', 'mba'],
    track: 'academic',
    icon: 'BriefcaseBusiness',
    order: 902,
    topicCount: 2,
    status: 'published',
    description: 'A practical framework for separating symptoms from causes, comparing options, making defensible recommendations and connecting marketing choices to customer needs.',
  },
  {
    id: 'universal-science-reasoning',
    name: 'Science Reasoning: Experiments, Data & Units',
    stream: 'science',
    programs: ['bsc', 'bca', 'mca', 'cse', 'ece', 'eee', 'me', 'cv'],
    track: 'academic',
    icon: 'FlaskConical',
    order: 903,
    topicCount: 2,
    status: 'published',
    description: 'Transferable scientific habits for designing fair tests, interpreting evidence, checking units and communicating uncertainty across scientific and technical subjects.',
  },
  {
    id: 'universal-arts-analysis',
    name: 'Arts & Social Inquiry: Read, Argue, Interpret',
    stream: 'communication',
    programs: ['ba', 'bcom', 'bba', 'bsc'],
    track: 'academic',
    icon: 'MessagesSquare',
    order: 904,
    topicCount: 2,
    status: 'published',
    description: 'Methods for reading sources critically, constructing evidence-based arguments and interpreting social data without confusing association with cause.',
  },
]

const topics = (subjectId: string, entries: PrepTopic[]): [string, PrepTopic[]] => [subjectId, entries]

export const UNIVERSAL_ACADEMIC_TOPICS: Record<string, PrepTopic[]> = Object.fromEntries([
  topics('universal-study-toolkit', [
    {
      id: 'uac-decode-the-question', subjectId: 'universal-study-toolkit', title: 'Decode the Question Before You Solve It',
      moduleNumber: 1, moduleName: 'Read → Represent → Solve → Check', order: 1, difficulty: 'basic', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-decode'], subtopics: ['Command words and task shape', 'Knowns, unknowns and constraints', 'Choosing a representation'],
      explanationMd: `# Decode the Question Before You Solve It\n\nA difficult-looking question often becomes manageable once you translate it into a small, precise task. Before reaching for a formula or writing a paragraph, answer four questions: **What is being asked? What information is given? What conditions must stay true? What form should the answer take?**\n\n## 1. Read the command, not just the topic\nWords such as *calculate*, *explain*, *compare*, *justify* and *evaluate* ask for different work. “Compare” needs a shared basis and at least two sides. “Evaluate” needs evidence, a judgement and a reason for that judgement. A correct definition alone does not complete either task.\n\n## 2. Make a tiny question map\nWrite the target as **Find / Explain / Decide: ___**. List givens and constraints separately. In a numerical problem, label values with units; in a case or essay, list the facts, people affected, time period and evidence. This prevents a memorable but irrelevant fact from taking over the answer.\n\n## Worked example\nA shop buys 40 notebooks for ₹12 each and 60 for ₹18 each. What is the average cost per notebook? The target is an average **per notebook**. The quantities are unequal, so use a weighted average: total cost = 40×12 + 60×18 = ₹1,560; total notebooks = 100; average = ₹15.60. The simple mean (₹15) would incorrectly give both batches equal influence.\n\n## A useful representation\nTurn words into a table, timeline, diagram, equation, claim-evidence list or comparison grid. The best representation is the one that makes relationships visible—not the one that looks most advanced. State any assumption you add.`,
      formulas: [{ id: 'uac-f-decode', label: 'Question map', formula: 'Task = target + givens + constraints + answer form', exampleQ: 'What should you identify before selecting a formula?', exampleA: 'The target, the information supplied, the constraints and the form of answer required.' }],
      tricks: [{ id: 'uac-t-command', title: 'Treat the command word as a contract', trick: 'Underline the action verb, then check your final response against it. “Compare” must show similarities or differences; “justify” must support a choice with reasons.', whenToUse: 'Before starting a written, numerical or case-based question.' }],
      howToSolve: [
        { id: 'uac-h-decode-1', step: '1. State the target in your own words', detail: 'Complete “I need to find/explain/choose ___.” If you cannot complete it, reread the final sentence of the question.', questionType: 'Any problem or written response' },
        { id: 'uac-h-decode-2', step: '2. Separate givens from assumptions', detail: 'List facts explicitly supplied. Put any extra assumption in a separate line and make sure it is reasonable.', questionType: 'Numerical problem or case' },
        { id: 'uac-h-decode-3', step: '3. Choose a representation', detail: 'Use a labelled equation, diagram, table, timeline or claim-evidence map that exposes the relationship you need.', questionType: 'Any problem or written response' },
        { id: 'uac-h-decode-4', step: '4. Confirm the answer shape', detail: 'Decide whether the task needs a value with units, a definition, a comparison, a recommendation or a reasoned argument.', questionType: 'Any problem or written response' },
      ],
    },
    {
      id: 'uac-build-clear-answer', subjectId: 'universal-study-toolkit', title: 'Turn Understanding into a Clear Answer',
      moduleNumber: 1, moduleName: 'Read → Represent → Solve → Check', order: 2, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-answer'], subtopics: ['Lead with the answer', 'Show the reasoning chain', 'Use examples and evidence'],
      explanationMd: `# Turn Understanding into a Clear Answer\n\nKnowing an idea and communicating it are different skills. A strong answer makes the reasoning visible, uses evidence where needed and ends by answering the exact question.\n\n## The Claim → Reason → Evidence → Link pattern\n1. **Claim:** give the direct answer or main point.\n2. **Reason:** explain the principle that makes it true.\n3. **Evidence/example:** show a calculation, fact, case detail or concrete example.\n4. **Link:** state how this proves the answer to the question.\n\nFor a short response, these may fit in four sentences. For a longer response, use them as the spine of each paragraph. Avoid opening with a long background section that delays the answer.\n\n## Worked example\nQuestion: “Why can a company report profit but still struggle to pay bills?”\n- **Claim:** Profit does not guarantee enough cash on the due date.\n- **Reason:** Profit records income and expenses for a period; cash flow records when money actually enters or leaves.\n- **Example:** A credit sale can increase revenue and profit today, while the customer pays next month.\n- **Link:** The company may therefore owe suppliers before collecting from customers.\n\n## Add depth without adding filler\nFor a comparison, use the same criterion on both sides. For a recommendation, name the objective, option, evidence, trade-off and next step. For a calculation, show the formula, substitution, result and interpretation. A diagram only helps when labels and a sentence explain what it shows.\n\n## Self-check\nCould a reader point to the sentence that answers the question? Can they follow how you reached it? Is each example relevant? If not, revise for logic before polishing wording.`,
      formulas: [{ id: 'uac-f-answer', label: 'Clear answer structure', formula: 'Answer = Claim + Reason + Evidence/Example + Link to the question', exampleQ: 'What connects an example back to the prompt?', exampleA: 'A final link sentence explaining what the example demonstrates about the question.' }],
      tricks: [{ id: 'uac-t-answer', title: 'Use “because” to expose missing logic', trick: 'After every major claim, ask “because why?” If you cannot add a reason or evidence, the point may be unsupported or incomplete.', whenToUse: 'Essay, theory, case-analysis and short-answer questions.' }],
      howToSolve: [
        { id: 'uac-h-answer-1', step: '1. Answer first', detail: 'Write one sentence that directly responds to the command word and question stem.', questionType: 'Short or long written answer' },
        { id: 'uac-h-answer-2', step: '2. Explain the principle', detail: 'Name the concept and explain the causal or logical connection in your own words.', questionType: 'Concept explanation' },
        { id: 'uac-h-answer-3', step: '3. Support it', detail: 'Add the relevant calculation, source fact, case detail, example or labelled diagram.', questionType: 'Evidence-based answer' },
        { id: 'uac-h-answer-4', step: '4. Link back and check scope', detail: 'State what the support proves and remove material that does not help answer the prompt.', questionType: 'Any written response' },
      ],
    },
    {
      id: 'uac-choose-a-method', subjectId: 'universal-study-toolkit', title: 'Choose the Right Method: Model the Problem',
      moduleNumber: 2, moduleName: 'Build a Model That Fits', order: 3, difficulty: 'advanced', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-method'], subtopics: ['Match the method to the relationship', 'Make assumptions explicit', 'Keep interpretation separate from calculation'],
      explanationMd: `# Choose the Right Method: Model the Problem\n\nA formula is not a magic shortcut. It is a compact model of a relationship. The right tool depends on what the quantities mean, how they relate and what the question asks.\n\n## A method-selection ladder\n- **Count or classify:** organise cases in a table or category list.\n- **Compare parts of a whole:** identify the correct base before using a ratio or percentage.\n- **Combine unequal groups:** use a weighted average, not an unweighted mean.\n- **Study change over time:** preserve the time order and distinguish a total from a rate.\n- **Explain a case:** connect evidence to a mechanism; do not just attach a framework label.\n- **Interpret data:** identify the population, sample, variables and uncertainty.\n\n## Worked example: choosing an average\nTwo tutorial groups have mean scores of 70 and 80. The first has 10 learners; the second has 30. The combined mean is not (70+80)/2 because the group sizes differ. Total score = 10×70 + 30×80 = 3,100; learners = 40; combined mean = 77.5. The model assumes both means use the same score scale and all learners count once.\n\n## Advanced habit: state the model boundary\nEvery method has conditions. A straight-line model assumes a constant rate; a sample mean describes the observed group but may not perfectly describe a population; a case framework is a lens, not proof. Write the assumption, solve, then ask whether the result still makes sense if the assumption is weakened.\n\n## Avoid two extremes\nDo not force a familiar formula onto a mismatched question. Also do not overcomplicate a simple relationship. Sketching a quick table often reveals the simplest valid method.`,
      formulas: [{ id: 'uac-f-weighted', label: 'Weighted mean', formula: 'Combined mean = Σ(group size × group mean) ÷ total group size', exampleQ: '10 learners average 70 and 30 learners average 80. Find the combined mean.', exampleA: '(10×70 + 30×80) ÷ 40 = 77.5.' }],
      tricks: [{ id: 'uac-t-conditions', title: 'Check the denominator before the numerator', trick: 'Ask “per what?” or “out of what?” before calculating a rate, ratio or percentage. Many wrong answers use the right arithmetic with the wrong base.', whenToUse: 'Rates, ratios, percentages, averages and data questions.' }],
      howToSolve: [
        { id: 'uac-h-method-1', step: '1. Name the relationship', detail: 'Is the problem about parts, a rate, a weighted combination, change, evidence or a decision?', questionType: 'Method selection' },
        { id: 'uac-h-method-2', step: '2. Match a representation to it', detail: 'Use a table for groups, a graph for change, an equation for a stable relationship, or a claim-evidence map for an argument.', questionType: 'Method selection' },
        { id: 'uac-h-method-3', step: '3. State necessary assumptions', detail: 'Check equal units, comparable groups, independent observations or any simplifying condition the method requires.', questionType: 'Quantitative or analytical problem' },
        { id: 'uac-h-method-4', step: '4. Solve, then interpret', detail: 'Translate the computed or reasoned result back into the original situation and note the model’s limits.', questionType: 'Quantitative or analytical problem' },
      ],
    },
    {
      id: 'uac-check-your-work', subjectId: 'universal-study-toolkit', title: 'Check Your Work: Units, Logic & Plausibility',
      moduleNumber: 2, moduleName: 'Build a Model That Fits', order: 4, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-check'], subtopics: ['Dimensional checks', 'Reverse checks', 'Boundary and reasonableness checks'],
      explanationMd: `# Check Your Work: Units, Logic & Plausibility\n\nA polished calculation can still be wrong. Verification is part of solving, not an optional final decoration. Use checks that are independent of the step most likely to contain the error.\n\n## Four quick checks\n1. **Units:** do the units match the requested quantity? Adding metres to seconds is a warning; dividing distance by time should produce distance per time.\n2. **Sign and direction:** should the answer rise or fall when an input rises? Does a cost become negative without a reason?\n3. **Magnitude:** compare with a rough estimate or a known scale. A monthly amount mistaken for an annual amount is often exposed here.\n4. **Reverse or boundary check:** substitute the result back, undo the operation, or test a simple extreme case.\n\n## Worked example\nA student walks 1.5 km in 20 minutes. Convert 20 minutes to 1/3 hour, then speed = 1.5 ÷ (1/3) = 4.5 km/h. A result of 0.075 km/h signals that minutes and hours may have been mixed. A reverse check gives 4.5×(1/3)=1.5 km.\n\n## Check written reasoning too\nAsk whether the evidence actually supports the claim, whether a counterexample changes the conclusion, and whether the final sentence answers the prompt. A correlation check cannot establish cause by itself. A ratio without its comparison group can be misleading.\n\n## Precision is not accuracy\nExtra decimal places do not repair weak measurements or assumptions. Keep precision consistent with the data supplied, and explain uncertainty when it matters.`,
      formulas: [{ id: 'uac-f-check', label: 'Rate sanity check', formula: 'Rate = amount ÷ matching time interval', exampleQ: '1.5 km in 20 minutes: what is the speed in km/h?', exampleA: '20 minutes = 1/3 hour; 1.5 ÷ (1/3) = 4.5 km/h.' }],
      tricks: [{ id: 'uac-t-estimate', title: 'Estimate before exact arithmetic', trick: 'Round inputs to easy values first. If the exact result is far outside the estimate, recheck units, the base and the operation before redoing every step.', whenToUse: 'Any calculation, especially multi-step problems.' }],
      howToSolve: [
        { id: 'uac-h-check-1', step: '1. Check the requested unit or answer type', detail: 'Write the target unit beside the blank before calculating; for theory, write the required judgement or comparison.', questionType: 'Any problem' },
        { id: 'uac-h-check-2', step: '2. Predict the direction and rough size', detail: 'Make a quick estimate and decide whether the answer should be positive, negative, larger or smaller.', questionType: 'Quantitative or analytical problem' },
        { id: 'uac-h-check-3', step: '3. Use an independent check', detail: 'Substitute, reverse the calculation, compare with a second representation or test a simple boundary case.', questionType: 'Calculation or model problem' },
        { id: 'uac-h-check-4', step: '4. Explain the result in context', detail: 'Add units and one sentence of interpretation; do not report an unexplained number or claim.', questionType: 'Any problem' },
      ],
    },
    {
      id: 'uac-active-recall', subjectId: 'universal-study-toolkit', title: 'Learn for Understanding: Retrieval & Spacing',
      moduleNumber: 3, moduleName: 'Practise → Retrieve → Improve', order: 5, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-recall'], subtopics: ['Active recall', 'Spaced review', 'Interleaving similar methods'],
      explanationMd: `# Learn for Understanding: Retrieval & Spacing\n\nRereading feels fluent because the page supplies the cues. In an assessment, those cues may be absent. **Retrieval practice** means closing the notes and trying to reconstruct the idea, solve a fresh example or explain the concept aloud. The effort reveals what is genuinely retrievable.\n\n## A small repeatable cycle\n1. Study one short idea and one worked example.\n2. Hide the explanation and reproduce the main steps from memory.\n3. Check against the source and mark the exact gap.\n4. Revisit later, then mix the idea with a similar but different problem.\n\nSpacing means returning after a delay rather than cramming one long block. A simple starting schedule is same day, next day, several days later, then about a week later. Adjust it: if recall is easy, lengthen the gap; if it fails, shorten the gap and practise the missing step.\n\n## Worked example: learning a method\nInstead of reading a ratio solution three times, cover it and write: “What is the base? Which number is compared with it? Is the result a proportion or a percentage?” Then solve a new set of values and explain why the denominator is appropriate.\n\n## Interleave carefully\nAfter you can do one method alone, mix it with a similar method. For example, alternate a simple average and a weighted average so you learn to recognise when group sizes matter. If every question is mixed before you know either method, the exercise may feel random; build fluency first, then practise selection.\n\n## Measure learning by transfer\nThe goal is not to recite a paragraph exactly. It is to explain the idea in your own words and use it on a new problem.`,
      formulas: [{ id: 'uac-f-recall', label: 'Practice loop', formula: 'Attempt from memory → Check → Diagnose gap → Retry later', exampleQ: 'What should follow a failed retrieval attempt?', exampleA: 'Check the source, identify the specific missing step, then retry that step after feedback.' }],
      tricks: [{ id: 'uac-t-recall', title: 'Close the notes before you feel ready', trick: 'Try a two-minute blank-page recall before rereading. The missing pieces become your study agenda instead of inviting another passive review.', whenToUse: 'After a short lesson or at the start of revision.' }],
      howToSolve: [
        { id: 'uac-h-recall-1', step: '1. Retrieve without looking', detail: 'Write the definition, diagram, method or answer skeleton from memory before opening notes.', questionType: 'Study method' },
        { id: 'uac-h-recall-2', step: '2. Compare and mark gaps', detail: 'Use a different colour to identify missing assumptions, steps, units or evidence.', questionType: 'Study method' },
        { id: 'uac-h-recall-3', step: '3. Practise a new example', detail: 'Change the values or context so you test the principle, not just the remembered wording.', questionType: 'Transfer practice' },
        { id: 'uac-h-recall-4', step: '4. Schedule a later retrieval', detail: 'Choose the next review interval based on how much you recalled accurately.', questionType: 'Study method' },
      ],
    },
    {
      id: 'uac-learn-from-errors', subjectId: 'universal-study-toolkit', title: 'Use Mistakes as Data: A Personal Error Log',
      moduleNumber: 3, moduleName: 'Practise → Retrieve → Improve', order: 6, difficulty: 'advanced', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-errors'], subtopics: ['Concept errors', 'Setup and execution errors', 'Feedback loop'],
      explanationMd: `# Use Mistakes as Data: A Personal Error Log\n\nA wrong answer is most useful when you can say **why** it went wrong and what you will do differently next time. Copying the correct answer without diagnosing the error often repeats the same mistake.\n\n## Classify the error\n- **Concept:** the underlying idea was misunderstood.\n- **Recognition:** the idea was known, but the question type was misidentified.\n- **Setup:** the right method was chosen but values, units, denominator or assumptions were wrong.\n- **Execution:** arithmetic, algebra, coding or sentence-level steps slipped.\n- **Communication:** the reasoning may be sound, but the final answer omitted a unit, evidence, comparison or direct conclusion.\n- **Attention:** a condition or command word was missed.\n\n## The three-line log\nFor each useful mistake, record: (1) **My move:** what I did; (2) **Why it failed:** the exact mistaken assumption or step; (3) **Next cue:** what feature will remind me to choose a better move. Keep the entry short enough to review.\n\n## Worked example\nMistake: used the simple average of two class averages even though one group was much larger. Diagnosis: setup error—treated the groups as equally weighted. Next cue: “Check group sizes before averaging.” The next practice should include unequal groups to test the correction.\n\n## Advanced use\nIf the same error appears repeatedly, search for a common cause across topics: unit conversion, hurried reading, weak prerequisite knowledge or a missing check. Then practise that cause directly. Do not overlearn a trick for one question if the underlying concept is still unclear.`,
      formulas: [{ id: 'uac-f-errors', label: 'Error-to-improvement loop', formula: 'Mistake → Cause → Next cue → Targeted retry', exampleQ: 'What makes an error log actionable?', exampleA: 'A specific diagnosis and a cue or practice action that addresses the cause.' }],
      tricks: [{ id: 'uac-t-error', title: 'Fix the cause, not the score', trick: 'Before viewing the worked answer, point to the first step where your reasoning diverged. That is usually more useful than focusing only on the final wrong number.', whenToUse: 'After quizzes, practice sets, coding runs or written feedback.' }],
      howToSolve: [
        { id: 'uac-h-error-1', step: '1. Find the first divergence', detail: 'Compare your work with the solution and identify the earliest incorrect decision, not merely the final mismatch.', questionType: 'Reviewing an answer' },
        { id: 'uac-h-error-2', step: '2. Label the cause', detail: 'Classify it as concept, recognition, setup, execution, communication or attention.', questionType: 'Reviewing an answer' },
        { id: 'uac-h-error-3', step: '3. Write one next-time cue', detail: 'Use a short prompt such as “check the base”, “convert units first” or “state evidence for the claim”.', questionType: 'Reviewing an answer' },
        { id: 'uac-h-error-4', step: '4. Retry a changed problem', detail: 'Solve a new example without looking; a changed context checks whether the correction transfers.', questionType: 'Targeted practice' },
      ],
    },
  ]),
  topics('universal-commerce-thinking', [
    {
      id: 'uac-accounting-as-a-story', subjectId: 'universal-commerce-thinking', title: 'Accounting as a Story of Resources and Claims',
      moduleNumber: 1, moduleName: 'Read the Numbers, Explain the Business', order: 1, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-accounting'], subtopics: ['The accounting equation', 'Transaction effects', 'Profit versus cash'],
      explanationMd: `# Accounting as a Story of Resources and Claims\n\nFinancial statements make more sense when you read them as a connected story. The balance sheet asks **what resources are controlled and who has claims on them?** The income statement asks **what was earned and used during a period?** Cash-flow information asks **when cash actually moved?** These views are related but not interchangeable.\n\n## The anchor equation\n**Assets = Liabilities + Equity.** Every recorded transaction keeps this relationship in balance. Assets are resources; liabilities are claims by others; equity is the owners’ residual claim. Revenue and expenses change equity through profit.\n\n## Worked transaction chain\nAn owner contributes ₹10,000 cash: assets +₹10,000 and equity +₹10,000. The business buys inventory for ₹3,000 cash: cash falls and inventory rises, so total assets do not change. It sells inventory that cost ₹800 for ₹1,200 cash: cash rises by ₹1,200, inventory falls by ₹800, and profit/equity rises by ₹400. Closing assets are ₹8,200 cash + ₹2,200 inventory = ₹10,400; equity is ₹10,000 capital + ₹400 profit. The equation still balances.\n\n## Debit and credit are directions, not everyday meanings\nDo not memorise “debit means money in” or “credit means money out.” Each account has a normal side. Assets and expenses normally increase by debit; liabilities, equity and revenue normally increase by credit. A transaction’s full entry preserves double-entry equality.\n\n## The deeper distinction: profit is not cash\nA credit sale may create revenue before cash is collected. Buying long-lived equipment uses cash now but its cost is usually allocated over periods through depreciation. Ask which statement and time basis the question concerns before choosing a figure.`,
      formulas: [
        { id: 'uac-f-accounting-equation', label: 'Accounting equation', formula: 'Assets = Liabilities + Equity', exampleQ: 'If assets are ₹10,400 and liabilities are zero, what is equity?', exampleA: 'Equity = Assets − Liabilities = ₹10,400.' },
        { id: 'uac-f-profit', label: 'Profit for a period', formula: 'Profit = Revenue − Expenses', exampleQ: 'Revenue is ₹1,200 and the inventory sold cost ₹800. Find gross profit before other expenses.', exampleA: '₹1,200 − ₹800 = ₹400.' },
      ],
      tricks: [{ id: 'uac-t-accounting', title: 'Ask “what changed?” in three places', trick: 'For every transaction, name the accounts affected, state whether each rises or falls, then verify Assets = Liabilities + Equity. This is safer than guessing debit/credit from the words.', whenToUse: 'Transaction analysis, journal entries and statement questions.' }],
      howToSolve: [
        { id: 'uac-h-accounting-1', step: '1. Identify the event and time', detail: 'Separate what happened now from what will be paid, earned or consumed later.', questionType: 'Transaction analysis' },
        { id: 'uac-h-accounting-2', step: '2. Classify each effect', detail: 'Mark each account as asset, liability, equity, revenue or expense; then write increase or decrease.', questionType: 'Transaction analysis' },
        { id: 'uac-h-accounting-3', step: '3. Record both sides', detail: 'Apply the account’s normal balance and ensure total debits equal total credits.', questionType: 'Journal entry' },
        { id: 'uac-h-accounting-4', step: '4. Reconcile the story', detail: 'Check the accounting equation and explain whether the event affected profit, cash, both or neither immediately.', questionType: 'Statement interpretation' },
      ],
    },
    {
      id: 'uac-ratios-with-meaning', subjectId: 'universal-commerce-thinking', title: 'Ratios with Meaning: Calculation, Comparison, Interpretation',
      moduleNumber: 2, moduleName: 'Read the Numbers, Explain the Business', order: 2, difficulty: 'advanced', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-ratio'], subtopics: ['Choose the matching base', 'Liquidity and profitability examples', 'Interpret limits and context'],
      explanationMd: `# Ratios with Meaning: Calculation, Comparison, Interpretation\n\nA ratio compresses a relationship; it does not automatically tell you whether a business is “good” or “bad.” A complete answer has three parts: calculate correctly, compare with a meaningful reference, then interpret the strength and limitation.\n\n## Start with the question the ratio answers\n- **Current ratio = current assets ÷ current liabilities:** a broad view of short-term coverage.\n- **Gross margin = gross profit ÷ revenue × 100%:** the share of sales left after direct cost of goods sold.\n- **Return on capital employed = operating profit ÷ capital employed × 100%:** operating return relative to longer-term funds invested.\n\n## Worked example\nCurrent assets are ₹240,000 and current liabilities ₹120,000. Current ratio = 2.0:1. That says current assets are twice current liabilities in total; it does **not** say all those assets can be used immediately. If ₹180,000 is slow-moving inventory and the remaining quick assets are ₹60,000, the quick ratio is only ₹60,000/₹120,000 = 0.5:1. The composition changes the interpretation.\n\n## Compare like with like\nA trend across several periods can reveal direction; a peer comparison can show relative position; a target can show a gap. Use the same definitions, period length and accounting basis. A seasonal business, an unusual one-off event or a change in policy may make the comparison unfair.\n\n## Strong interpretation sentence\n“X is ___, compared with ___; this suggests ___ because ___. However, ___ is a limitation, so we should also inspect ___.” This protects you from declaring that a single ratio proves overall performance.`,
      formulas: [
        { id: 'uac-f-current-ratio', label: 'Current ratio', formula: 'Current ratio = Current assets ÷ Current liabilities', exampleQ: 'Current assets ₹240,000; current liabilities ₹120,000. Find the ratio.', exampleA: '₹240,000 ÷ ₹120,000 = 2.0:1.' },
        { id: 'uac-f-gross-margin', label: 'Gross margin', formula: 'Gross margin (%) = Gross profit ÷ Revenue × 100', exampleQ: 'Gross profit is ₹36,000 on revenue of ₹120,000. Find gross margin.', exampleA: '₹36,000 ÷ ₹120,000 × 100 = 30%.' },
      ],
      tricks: [{ id: 'uac-t-ratio', title: 'Say what the denominator represents', trick: 'Before interpreting a ratio, finish the sentence “per every one unit of ___.” It reveals whether the base is sales, debt, capital, time or people.', whenToUse: 'Ratio analysis, business reports and numerical explanations.' }],
      howToSolve: [
        { id: 'uac-h-ratio-1', step: '1. Identify the decision or question', detail: 'Is the problem about liquidity, profitability, efficiency, leverage or return?', questionType: 'Ratio analysis' },
        { id: 'uac-h-ratio-2', step: '2. Match numerator, denominator and period', detail: 'Use the stated definitions; align the time period and units before substituting values.', questionType: 'Ratio calculation' },
        { id: 'uac-h-ratio-3', step: '3. Calculate and label', detail: 'Show the formula, substitution, result and ratio/percentage unit.', questionType: 'Ratio calculation' },
        { id: 'uac-h-ratio-4', step: '4. Compare and qualify', detail: 'Compare with a relevant trend, peer or benchmark, then state one limitation or additional figure to inspect.', questionType: 'Ratio interpretation' },
      ],
    },
  ]),
  topics('universal-management-cases', [
    {
      id: 'uac-case-to-decision', subjectId: 'universal-management-cases', title: 'Solve a Business Case: From Symptom to Defensible Decision',
      moduleNumber: 1, moduleName: 'Analyse → Choose → Act', order: 1, difficulty: 'advanced', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-case'], subtopics: ['Separate symptom from cause', 'Set criteria before choosing', 'Recommendations with measures'],
      explanationMd: `# Solve a Business Case: From Symptom to Defensible Decision\n\nCase questions reward a clear chain from **evidence → diagnosis → options → decision → action**. Naming SWOT, PESTLE or another framework without applying case facts is not analysis. Use a framework only when it helps you see something the facts alone do not make obvious.\n\n## A six-part case map\n1. **Objective:** what outcome matters, and by when?\n2. **Evidence:** which case facts support the diagnosis? Separate fact from assumption.\n3. **Root cause:** what mechanism could produce the symptom?\n4. **Options:** include at least two realistic actions, not just “do nothing” and a perfect solution.\n5. **Criteria and trade-offs:** compare cost, speed, risk, stakeholder effect and reversibility.\n6. **Recommendation and test:** choose, explain why, name the first action and track a measurable result.\n\n## Worked mini-case\nA campus café’s queue doubled after lunch service expanded. The symptom is longer waiting. Before hiring more staff, inspect arrival rate, service time, menu complexity and order errors. Suppose transactions per hour rose 40% while staffing and kitchen layout stayed constant. Options might be a limited fast menu during peak time, pre-order pickup or additional staffing. Compare setup cost, expected queue reduction and customer impact; pilot one option for two weeks and track median wait and order accuracy.\n\n## Advanced caution: do not confuse correlation with diagnosis\nTwo events occurring together do not show that one caused the other. Look for a plausible mechanism and test whether the evidence rules out obvious alternatives. A recommendation is stronger when you state what new evidence would make you change it.`,
      formulas: [{ id: 'uac-f-case', label: 'Case answer chain', formula: 'Evidence → Cause → Options → Criteria → Recommendation → Measure', exampleQ: 'What must connect a recommendation to a case?', exampleA: 'Relevant case evidence and explicit decision criteria.' }],
      tricks: [{ id: 'uac-t-case', title: 'Write the objective before naming a framework', trick: 'If you cannot say what outcome the organisation is trying to improve, a framework list will not rescue the case answer.', whenToUse: 'Business cases, management decisions and consulting-style prompts.' }],
      howToSolve: [
        { id: 'uac-h-case-1', step: '1. State the decision and objective', detail: 'Turn the prompt into one sentence: who must decide what, to improve which outcome?', questionType: 'Business case' },
        { id: 'uac-h-case-2', step: '2. Extract facts and diagnose', detail: 'Quote or paraphrase the strongest facts; distinguish them from assumptions and identify a plausible root cause.', questionType: 'Business case' },
        { id: 'uac-h-case-3', step: '3. Compare feasible options', detail: 'Use two or more relevant criteria and acknowledge at least one trade-off or risk.', questionType: 'Business case' },
        { id: 'uac-h-case-4', step: '4. Recommend, implement and measure', detail: 'Give the next action, owner or sequence, a measurable success indicator and a review point.', questionType: 'Recommendation' },
      ],
    },
    {
      id: 'uac-customer-to-marketing', subjectId: 'universal-management-cases', title: 'Marketing Logic: Connect a Customer Problem to the 4Ps',
      moduleNumber: 2, moduleName: 'Analyse → Choose → Act', order: 2, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-marketing'], subtopics: ['Segment, target and position', 'Align the 4Ps', 'Choose a measurable signal'],
      explanationMd: `# Marketing Logic: Connect a Customer Problem to the 4Ps\n\nThe 4Ps—product, price, place and promotion—are decisions, not four boxes to fill with unrelated ideas. Begin with a customer need and a clearly chosen audience; then make the four decisions reinforce the same position.\n\n## Worked example\nSuppose research suggests that busy students want an affordable lunch they can collect quickly. A **segment** could be time-pressed campus learners; a **target** is the group the café can serve well; a **position** might be “fresh lunch ready in under five minutes.” The product could be a small rotating set of balanced meals; price should fit the students’ budget and costs; place could be a pickup counter near the main path; promotion should make the speed and menu visible where target learners decide.\n\n## Check the fit\nIf promotion promises “fast” but the process is slow, the mix contradicts itself. If a premium product is aimed at a price-sensitive segment, explain what value justifies the price or revise the target. A good answer links each choice to customer evidence and to the positioning.\n\n## Measure what the objective says\nFor a speed promise, track median preparation time and repeat purchase—not only social-media impressions. For awareness, a reach or recall measure may fit. Distinguish an activity (posting an ad) from an outcome (more qualified visits or purchases).\n\n## Use frameworks as scaffolds\nSegmentation variables and positioning maps help organise evidence, but they do not replace it. Avoid claiming that “everyone” is the target; name the group and explain why it is reachable and valuable.`,
      formulas: [{ id: 'uac-f-marketing', label: 'Marketing sequence', formula: 'Customer evidence → Segment → Target → Position → Aligned 4Ps → Outcome metric', exampleQ: 'What should guide the product, price, place and promotion choices?', exampleA: 'The target customer’s evidence-based need and the intended position.' }],
      tricks: [{ id: 'uac-t-marketing', title: 'Read the 4Ps as one promise', trick: 'After writing the mix, ask whether a customer would receive the same promise from the product, price, access and message. A mismatch is a case-analysis clue.', whenToUse: 'Marketing mix and strategy case questions.' }],
      howToSolve: [
        { id: 'uac-h-marketing-1', step: '1. Identify the customer problem', detail: 'Use a fact from the scenario; do not assume a need just because it fits a familiar product.', questionType: 'Marketing case' },
        { id: 'uac-h-marketing-2', step: '2. Specify the target and position', detail: 'Name who the offer serves and the distinct value it promises relative to alternatives.', questionType: 'STP analysis' },
        { id: 'uac-h-marketing-3', step: '3. Align all four decisions', detail: 'Tie each P to the same target and position; explain at least one trade-off.', questionType: 'Marketing mix' },
        { id: 'uac-h-marketing-4', step: '4. Match a metric to the goal', detail: 'Choose a measure of the desired customer outcome, not merely a count of marketing activity.', questionType: 'Marketing recommendation' },
      ],
    },
  ]),
  topics('universal-science-reasoning', [
    {
      id: 'uac-design-a-fair-test', subjectId: 'universal-science-reasoning', title: 'Design a Fair Test: Variables, Controls & Evidence',
      moduleNumber: 1, moduleName: 'Ask → Test → Interpret', order: 1, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-experiment'], subtopics: ['A testable question', 'Independent and dependent variables', 'Controls, repeats and confounders'],
      explanationMd: `# Design a Fair Test: Variables, Controls & Evidence\n\nA scientific investigation is a structured way to reduce uncertainty. It does not begin by trying to prove a favourite answer. It begins with a testable question, a clear measure and a plan that makes alternative explanations less likely.\n\n## Build the design\n- **Question:** specify the relationship or effect you will examine.\n- **Hypothesis:** make a prediction that could be contradicted by data.\n- **Independent variable:** the factor deliberately changed.\n- **Dependent variable:** the outcome measured.\n- **Controls:** conditions held as constant as practical.\n- **Repeats/sample:** enough observations to distinguish a pattern from random variation.\n\n## Worked example\nQuestion: does light intensity affect the growth rate of a plant species? Change light intensity across groups; measure height change over a fixed period. Keep species, soil, water, pot size and temperature as similar as possible, randomise pot positions if feasible, and use several plants per condition. If the high-light group also receives more water, light and water are confounded: the result cannot be attributed to light alone.\n\n## Interpret evidence proportionally\nA result may support a hypothesis under the tested conditions; it rarely proves a universal law by itself. Report the method, sample, variation and limitations. A null result can mean no detectable effect in this design—not necessarily that no effect exists anywhere.\n\n## Advanced transfer\nIn observational data, researchers may not control the variable at all. Then they must consider confounding, selection and measurement bias, and use cautious causal language. Reproducible methods and transparent uncertainty make evidence more useful.`,
      formulas: [{ id: 'uac-f-experiment', label: 'Fair-test map', formula: 'Question → Change one factor → Measure an outcome → Control alternatives → Repeat', exampleQ: 'Why keep water the same when testing light intensity and plant growth?', exampleA: 'To reduce water as a confounding explanation for any observed growth difference.' }],
      tricks: [{ id: 'uac-t-variables', title: 'Ask “what else changed?”', trick: 'For every observed effect, list other factors that moved with the intended variable. Those co-moving factors are candidate confounders.', whenToUse: 'Experimental design and evaluation of evidence.' }],
      howToSolve: [
        { id: 'uac-h-experiment-1', step: '1. Make the question testable', detail: 'Name the population/system, factor, outcome and conditions you will compare.', questionType: 'Experimental design' },
        { id: 'uac-h-experiment-2', step: '2. Identify variables and controls', detail: 'State what changes, what is measured and which plausible alternatives should be held constant or recorded.', questionType: 'Experimental design' },
        { id: 'uac-h-experiment-3', step: '3. Plan repeats and measurement', detail: 'Use consistent instruments, units, timing and enough observations to show variability.', questionType: 'Experimental design' },
        { id: 'uac-h-experiment-4', step: '4. Interpret with limits', detail: 'Describe the pattern, uncertainty and design limitations; use “supports” rather than “proves” when appropriate.', questionType: 'Results interpretation' },
      ],
    },
    {
      id: 'uac-units-and-estimation', subjectId: 'universal-science-reasoning', title: 'Units, Estimates & Significant Figures: Catch Errors Early',
      moduleNumber: 2, moduleName: 'Ask → Test → Interpret', order: 2, difficulty: 'advanced', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-units'], subtopics: ['Dimensional analysis', 'Order-of-magnitude estimates', 'Precision and uncertainty'],
      explanationMd: `# Units, Estimates & Significant Figures: Catch Errors Early\n\nUnits carry meaning. They can expose a wrong operation even when the arithmetic looks neat. Dimensional analysis checks whether the units on both sides of an equation are compatible; estimation checks whether the scale of the result is plausible.\n\n## Worked example\nA runner covers 400 m in 80 s. Average speed = distance/time = 400 m / 80 s = 5 m·s⁻¹. If a calculation gives 5 m·s, the unit is wrong: multiplying instead of dividing would also fail the dimensional check.\n\n## Convert before mixing units\nChoose a consistent unit system first. For example, 72 km/h = 72×1000/3600 m/s = 20 m/s. Write conversion factors as fractions so unwanted units cancel. Do not silently combine centimetres and metres or minutes and seconds.\n\n## Estimate before calculating precisely\nRound values to simple numbers, predict the order of magnitude, and compare the exact result. If a one-litre container appears to hold 80,000 litres in your answer, revisit prefixes and conversions.\n\n## Precision and uncertainty\nA result should not suggest more precision than the measurements support. Significant figures are a reporting convention; measurement uncertainty is the deeper issue. When inputs are approximate, state an appropriate rounded result and describe the uncertainty or assumptions rather than presenting false exactness.`,
      formulas: [
        { id: 'uac-f-speed', label: 'Average speed', formula: 'Average speed = distance ÷ elapsed time', exampleQ: '400 m in 80 s: find average speed.', exampleA: '400 m ÷ 80 s = 5 m/s.' },
        { id: 'uac-f-convert', label: 'Speed conversion', formula: 'km/h to m/s: multiply by 1000 ÷ 3600', exampleQ: 'Convert 72 km/h to m/s.', exampleA: '72×1000÷3600 = 20 m/s.' },
      ],
      tricks: [{ id: 'uac-t-cancel-units', title: 'Let units cancel on the page', trick: 'Write each conversion factor as a fraction and cross out matching units. If the desired unit does not remain, the setup needs repair before arithmetic.', whenToUse: 'Physics, chemistry, biology measurements and quantitative questions.' }],
      howToSolve: [
        { id: 'uac-h-units-1', step: '1. Write the target unit', detail: 'Put the desired unit beside the unknown so every conversion has a destination.', questionType: 'Quantitative science problem' },
        { id: 'uac-h-units-2', step: '2. Convert to consistent units', detail: 'Use explicit conversion factors and cancel units before substituting.', questionType: 'Unit conversion' },
        { id: 'uac-h-units-3', step: '3. Estimate the scale', detail: 'Round inputs and predict the rough size and direction of the answer.', questionType: 'Calculation' },
        { id: 'uac-h-units-4', step: '4. Calculate and report honestly', detail: 'Show the equation, carry units, round to justified precision and note uncertainty where relevant.', questionType: 'Calculation and interpretation' },
      ],
    },
  ]),
  topics('universal-arts-analysis', [
    {
      id: 'uac-claim-evidence-argument', subjectId: 'universal-arts-analysis', title: 'Build an Evidence-Based Argument',
      moduleNumber: 1, moduleName: 'Read → Reason → Write', order: 1, difficulty: 'core', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-argument'], subtopics: ['Thesis and claim', 'Evidence and reasoning', 'Counterargument and qualification'],
      explanationMd: `# Build an Evidence-Based Argument\n\nA strong argument is not a loud opinion or a string of quotations. It is a claim supported by relevant evidence and an explanation of why that evidence supports the claim. The reader should be able to see the reasoning between the two.\n\n## A paragraph that does work\n- **Claim:** make one arguable point.\n- **Evidence:** use a reliable source, example, data point or case detail.\n- **Reasoning:** explain the connection; do not assume the evidence speaks for itself.\n- **Qualification:** note a limit, alternative explanation or condition when it matters.\n\n## Worked example\nClaim: a new bus route may improve access to evening classes. Evidence: the route adds two departures after the previous last bus, and a student survey reports that transport timing is a common barrier. Reasoning: later departures address the timing barrier for learners who depend on transit. Qualification: the survey is self-reported and does not show how many learners will actually use the route; a pilot should track ridership and attendance.\n\n## Read sources with care\nIdentify who produced a source, what it measures, when it was created and whose perspective may be missing. Quote only the words that matter; paraphrase accurately and preserve attribution. A source can be useful without being complete.\n\n## Answer an evaluative prompt\nState a clear judgement, establish criteria, support each reason, address the strongest counterpoint and finish with a qualified conclusion. “It depends” is not enough—say what it depends on and why.`,
      formulas: [{ id: 'uac-f-argument', label: 'Argument paragraph', formula: 'Claim + Evidence + Reasoning + (Qualification when relevant)', exampleQ: 'What is missing if a paragraph gives a statistic but no explanation?', exampleA: 'Reasoning that connects the statistic to the claim.' }],
      tricks: [{ id: 'uac-t-argument', title: 'Use the “so what?” test', trick: 'After each piece of evidence, write one sentence beginning “This matters because…”. If it merely repeats the evidence, the reasoning link is still missing.', whenToUse: 'Essays, source analysis, reports and social-science answers.' }],
      howToSolve: [
        { id: 'uac-h-argument-1', step: '1. Turn the prompt into a position', detail: 'Write a direct, arguable answer rather than repeating the topic.', questionType: 'Essay or source analysis' },
        { id: 'uac-h-argument-2', step: '2. Select relevant evidence', detail: 'Choose evidence that supports the point and note its source, context and limitation.', questionType: 'Evidence-based response' },
        { id: 'uac-h-argument-3', step: '3. Explain the connection', detail: 'Make the reasoning explicit; state how the evidence supports or challenges the claim.', questionType: 'Argument paragraph' },
        { id: 'uac-h-argument-4', step: '4. Address a counterpoint and conclude', detail: 'Represent a reasonable alternative fairly, then explain why your judgement still holds or needs qualification.', questionType: 'Evaluate or discuss' },
      ],
    },
    {
      id: 'uac-interpret-data-with-care', subjectId: 'universal-arts-analysis', title: 'Interpret Social Data: Denominators, Comparisons & Causality',
      moduleNumber: 2, moduleName: 'Read → Reason → Write', order: 2, difficulty: 'advanced', tier: 'free',
      status: 'published', generatedBy: 'curator', contentVersion: 1, publishedAt: PUBLISHED_AT,
      featuredQuestionIds: ['uac-q-social-data'], subtopics: ['Read the base and population', 'Absolute versus relative change', 'Association versus cause'],
      explanationMd: `# Interpret Social Data: Denominators, Comparisons & Causality\n\nA percentage without its denominator is incomplete; a trend without a comparison point is hard to interpret. Before explaining a chart or claim, ask who was counted, what was measured, when it was measured and what the comparison is.\n\n## Worked example: counts versus rates\nTown A records 100 incidents among 10,000 residents; Town B records 150 among 30,000. B has more incidents in total, but the rates are 10 per 1,000 in A and 5 per 1,000 in B. The conclusion changes once population size is considered. A fair comparison uses the same definition and time period.\n\n## Absolute versus relative change\nIf a rate rises from 2% to 3%, that is an increase of 1 percentage point and a 50% relative increase. Both statements are mathematically true but answer different questions. State which one you use and show the base.\n\n## Association is not automatically causation\nIf two measures move together, several explanations are possible: one causes the other, reverse causality, a third factor affects both, or the relationship is partly due to selection or measurement. Causal claims need a design or argument that addresses these alternatives.\n\n## Write a careful conclusion\nDescribe the observed pattern first; give a plausible interpretation second; then state what the data cannot establish. This is not weakness—it is accurate reasoning. A small sample or missing group may limit how far the conclusion travels.`,
      formulas: [
        { id: 'uac-f-rate', label: 'Comparable rate', formula: 'Rate = count ÷ relevant population × scale factor', exampleQ: '100 incidents among 10,000 residents: incidents per 1,000?', exampleA: '100 ÷ 10,000 × 1,000 = 10 per 1,000.' },
        { id: 'uac-f-percentage-point', label: 'Percentage-point change', formula: 'New percentage − Old percentage', exampleQ: 'A rate rises from 2% to 3%. What is the percentage-point change?', exampleA: '3% − 2% = 1 percentage point; relative change is 50%.' },
      ],
      tricks: [{ id: 'uac-t-data', title: 'Read the denominator out loud', trick: 'Say “X out of which group, during what period?” before interpreting a percentage or rate. If the chart does not supply that information, state the limitation.', whenToUse: 'Charts, survey findings, policy claims and comparative statistics.' }],
      howToSolve: [
        { id: 'uac-h-data-1', step: '1. Identify the population, measure and period', detail: 'Read the axis, caption, units and definitions before describing a trend.', questionType: 'Data interpretation' },
        { id: 'uac-h-data-2', step: '2. Check the denominator and comparison', detail: 'Use comparable groups and distinguish counts, rates, percentage points and relative change.', questionType: 'Data interpretation' },
        { id: 'uac-h-data-3', step: '3. Describe before explaining', detail: 'State what the data show, then consider plausible mechanisms and alternative explanations.', questionType: 'Evidence analysis' },
        { id: 'uac-h-data-4', step: '4. Bound the conclusion', detail: 'Do not claim causation or generalise beyond the sample without supporting design and evidence.', questionType: 'Evidence-based conclusion' },
      ],
    },
  ]),
])

export const UNIVERSAL_ACADEMIC_QUESTIONS: UniversalQuestion[] = [
  {
    id: 'uac-q-decode', questionText: 'Two groups have different sizes and different averages. Which method usually gives the correct overall average?',
    options: ['Take the simple mean of the two group averages', 'Weight each group average by its group size', 'Use only the larger group average', 'Add the group sizes to the averages'],
    correctIndex: 1, explanation: 'Each learner should contribute equally, so each group mean must be weighted by the number of learners in that group.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-study-toolkit', topicIds: ['uac-decode-the-question'], stream: 'learning' }, tags: ['weighted average', 'question decoding'],
  },
  {
    id: 'uac-q-answer', questionText: 'A short answer makes a claim and gives a relevant example but never explains why the example supports the claim. What is the main gap?',
    options: ['A larger heading', 'The reasoning link', 'Another unrelated example', 'A longer introduction'],
    correctIndex: 1, explanation: 'Evidence or an example needs an explicit reasoning sentence that connects it to the claim and prompt.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-study-toolkit', topicIds: ['uac-build-clear-answer'], stream: 'learning' }, tags: ['answer writing', 'reasoning'],
  },
  {
    id: 'uac-q-method', questionText: 'Group A has 10 learners averaging 70; Group B has 30 learners averaging 80. What is the combined average?',
    options: ['75', '77.5', '78', '80'], correctIndex: 1,
    explanation: 'Weighted mean = (10×70 + 30×80) ÷ 40 = 3,100 ÷ 40 = 77.5.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-study-toolkit', topicIds: ['uac-choose-a-method'], stream: 'learning' }, tags: ['weighted mean', 'model selection'],
  },
  {
    id: 'uac-q-check', questionText: 'A learner walks 1.5 km in 20 minutes. What is the average speed in km/h?',
    options: ['0.075 km/h', '3 km/h', '4.5 km/h', '30 km/h'], correctIndex: 2,
    explanation: '20 minutes is one-third of an hour. Speed = 1.5 ÷ (1/3) = 4.5 km/h.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-study-toolkit', topicIds: ['uac-check-your-work'], stream: 'learning' }, tags: ['unit conversion', 'sanity check'],
  },
  {
    id: 'uac-q-recall', questionText: 'Which revision activity best checks whether a learner can retrieve a method without relying on the page?',
    options: ['Reread the same worked example repeatedly', 'Copy the headings in a different colour', 'Hide the notes and solve a changed example from memory', 'Highlight every formula'],
    correctIndex: 2, explanation: 'Retrieval from memory followed by a changed example checks both recall and transfer.', difficulty: 'basic', status: 'approved',
    prepTags: { subjectId: 'universal-study-toolkit', topicIds: ['uac-active-recall'], stream: 'learning' }, tags: ['active recall', 'study skills'],
  },
  {
    id: 'uac-q-errors', questionText: 'A student repeatedly averages two group means equally even when group sizes differ. Which next step is most useful?',
    options: ['Memorise the final answer only', 'Record the setup error and add a cue to check group sizes', 'Avoid all average questions', 'Add more decimal places'],
    correctIndex: 1, explanation: 'A targeted diagnosis and a next-time cue address the recurring setup mistake; then practise a changed example.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-study-toolkit', topicIds: ['uac-learn-from-errors'], stream: 'learning' }, tags: ['error analysis', 'weighted average'],
  },
  {
    id: 'uac-q-accounting', questionText: 'A business buys inventory for cash. Before the inventory is sold, what is the usual immediate effect on total assets?',
    options: ['Total assets rise by the purchase cost', 'Total assets fall by the purchase cost', 'One asset falls and another rises, so total assets are unchanged', 'Equity immediately falls by the purchase cost'],
    correctIndex: 2, explanation: 'Cash decreases while inventory increases by the same amount; the purchase is not normally an expense until the inventory is consumed or sold.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-commerce-thinking', topicIds: ['uac-accounting-as-a-story'], stream: 'commerce' }, tags: ['accounting equation', 'inventory'],
  },
  {
    id: 'uac-q-ratio', questionText: 'Current assets are ₹240,000 and current liabilities ₹120,000. Which interpretation is most accurate?',
    options: ['The business has exactly ₹2 cash for every ₹1 due', 'Current assets are twice current liabilities, but their liquidity and composition still matter', 'The business is certainly profitable', 'The business has no short-term risk'],
    correctIndex: 1, explanation: 'The ratio is 2:1, but current assets can include inventory or receivables that are not immediately cash; a ratio alone does not prove profitability or eliminate risk.', difficulty: 'advanced', status: 'approved',
    prepTags: { subjectId: 'universal-commerce-thinking', topicIds: ['uac-ratios-with-meaning'], stream: 'commerce' }, tags: ['current ratio', 'interpretation'],
  },
  {
    id: 'uac-q-case', questionText: 'A manager recommends hiring more staff because queues are long. What should strengthen the recommendation before action?',
    options: ['A list of management-framework names', 'Evidence about arrival rate, service time and the likely bottleneck', 'A longer description of the queue', 'A claim that every customer prefers more staff'],
    correctIndex: 1, explanation: 'A defensible diagnosis tests the likely cause with case evidence before choosing an intervention.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-management-cases', topicIds: ['uac-case-to-decision'], stream: 'management' }, tags: ['case analysis', 'root cause'],
  },
  {
    id: 'uac-q-marketing', questionText: 'A café promises “ready in five minutes” but its service process routinely takes fifteen. Which issue is clearest?',
    options: ['The marketing mix is internally inconsistent', 'The target segment is automatically too broad', 'Price must be the only problem', 'Promotion should replace operations'],
    correctIndex: 0, explanation: 'The promotional promise conflicts with the delivered service process; the 4Ps and operations need to support the same position.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-management-cases', topicIds: ['uac-customer-to-marketing'], stream: 'management' }, tags: ['marketing mix', 'positioning'],
  },
  {
    id: 'uac-q-experiment', questionText: 'In an experiment testing how light intensity affects plant growth, why keep water similar across groups?',
    options: ['To make water the dependent variable', 'To reduce water as an alternative explanation for growth differences', 'To guarantee the hypothesis is supported', 'To remove the need for repeated measurements'],
    correctIndex: 1, explanation: 'Keeping water similar controls a plausible confounder, making the effect of light easier to interpret.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-science-reasoning', topicIds: ['uac-design-a-fair-test'], stream: 'science' }, tags: ['experimental design', 'confounder'],
  },
  {
    id: 'uac-q-units', questionText: 'A runner covers 400 m in 80 s. Which average speed has both the right value and unit?',
    options: ['5 m/s', '5 m·s', '32,000 m/s', '0.2 s/m'], correctIndex: 0,
    explanation: 'Speed = distance ÷ time = 400/80 = 5, and the units are metres per second.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-science-reasoning', topicIds: ['uac-units-and-estimation'], stream: 'science' }, tags: ['dimensional analysis', 'units'],
  },
  {
    id: 'uac-q-argument', questionText: 'An essay includes a statistic but does not explain how it supports the paragraph’s claim. What should be added?',
    options: ['A reasoning link between evidence and claim', 'A second thesis statement', 'A longer quotation regardless of relevance', 'A new topic'], correctIndex: 0,
    explanation: 'Evidence must be interpreted and connected to the claim; otherwise the reader must guess the logic.', difficulty: 'core', status: 'approved',
    prepTags: { subjectId: 'universal-arts-analysis', topicIds: ['uac-claim-evidence-argument'], stream: 'communication' }, tags: ['argument', 'evidence'],
  },
  {
    id: 'uac-q-social-data', questionText: 'Town A has 100 incidents among 10,000 residents; Town B has 150 among 30,000. Which statement is correct?',
    options: ['Town B has the higher rate because it has more incidents', 'Town A has 10 per 1,000 and Town B has 5 per 1,000', 'Both towns have the same rate', 'The counts alone prove which town is less safe'], correctIndex: 1,
    explanation: 'A: 100/10,000×1,000 = 10 per 1,000. B: 150/30,000×1,000 = 5 per 1,000. Rates account for the different population sizes.', difficulty: 'advanced', status: 'approved',
    prepTags: { subjectId: 'universal-arts-analysis', topicIds: ['uac-interpret-data-with-care'], stream: 'communication' }, tags: ['rates', 'denominator', 'social data'],
  },
]

/** Complete cross-program pack; stable ids make explicit or repeated seeding idempotent. */
export const UNIVERSAL_ACADEMIC_BUNDLE = {
  subjects: UNIVERSAL_ACADEMIC_SUBJECTS,
  topics: UNIVERSAL_ACADEMIC_TOPICS,
  questions: UNIVERSAL_ACADEMIC_QUESTIONS,
}

/** Returns just the shared supplement subjects relevant to one program code. */
export function universalAcademicSupplementFor(programCode: string) {
  const code = programCode.trim().toLowerCase()
  const subjects = UNIVERSAL_ACADEMIC_SUBJECTS.filter((subject) => subject.programs.includes(code))
  const subjectIds = new Set(subjects.map((subject) => subject.id))
  return {
    subjects,
    topics: Object.fromEntries(Object.entries(UNIVERSAL_ACADEMIC_TOPICS).filter(([subjectId]) => subjectIds.has(subjectId))),
    questions: UNIVERSAL_ACADEMIC_QUESTIONS.filter((question) => subjectIds.has(question.prepTags.subjectId)),
  }
}
