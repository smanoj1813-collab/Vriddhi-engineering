// src/shared/constants/academicPrograms.ts
// SINGLE SOURCE OF TRUTH for B.E., B.Tech, and BCA programs, branches & subjects.

export const UG_PROGRAMS = [
  'ECE',
  'EEE',
  'MECH',
  'CIVIL',
  'CSE',
  'ISE',
  'AIML',
  'BCA',
  'B.E',
  'B.E (ECE)',
  'B.E (EEE)',
  'B.E (MECH)',
  'B.E (CIVIL)',
  'B.E (CSE)',
  'B.E (ISE)',
  'B.E (AI & ML)',
  'B.Tech',
  'B.Tech (ECE)',
  'B.Tech (EEE)',
  'B.Tech (MECH)',
  'B.Tech (CIVIL)',
  'B.Tech (CSE)',
  'B.Tech (ISE / IT)',
  'B.Tech (AI & ML)',
  'B.Tech (Data Science)',
  'BCA (Regular)',
  'BCA (AI & Data Science)',
  'BCA (Cloud & Cyber Security)',
] as const;

export const PG_PROGRAMS = [
  'MCA',
  'M.Tech',
  'M.Tech (VLSI & Embedded Systems)',
  'M.Tech (Power Electronics & Drives)',
  'M.Tech (CAD/CAM & Machine Design)',
  'M.Tech (Structural & Construction Engg)',
  'M.Tech (Computer Science & Engg)',
  'MBA',
] as const;

export const DEFAULT_PROGRAMS: string[] = [
  ...UG_PROGRAMS,
  ...PG_PROGRAMS,
  'Basic Sciences (1st Year Common)',
];

export const DEFAULT_BRANCHES = DEFAULT_PROGRAMS;

export const DEFAULT_DEPARTMENTS: string[] = [
  'Electronics & Communication Engineering (ECE)',
  'Electrical & Electronics Engineering (EEE)',
  'Mechanical Engineering (MECH)',
  'Civil Engineering (CIVIL)',
  'Computer Science & Engineering (CSE)',
  'Information Science & Engineering (ISE / IT)',
  'Artificial Intelligence & Machine Learning (AIML)',
  'Computer Applications (BCA / MCA)',
  'Basic Sciences & Humanities (1st Year B.E / B.Tech)',
  'Training & Placement (Industry Bridge)',
];

export const DEFAULT_DEPARTMENT = 'Electronics & Communication Engineering (ECE)';

export const DEFAULT_SUBJECTS: string[] = [
  'Engineering Mathematics - I',
  'Engineering Mathematics - II',
  'Engineering Mathematics - III',
  'Applied Engineering Physics',
  'Applied Engineering Chemistry',
  'Problem Solving through C Programming',
  'Python Programming & Data Analysis',
  'Computer Aided Engineering Drawing (CAED)',
  'Engineering Mechanics',
  'Communicative & Technical English',
  'Electronic Devices & Analog Circuits',
  'Digital System Design (Verilog HDL)',
  'Network Analysis & Circuit Theory',
  'Signals and Systems',
  'Analog & Digital Communication Systems',
  'Microcontrollers & Embedded Systems (8051 & ARM)',
  'Linear Integrated Circuits',
  'Control Systems Engineering',
  'Digital Signal Processing (DSP)',
  'CMOS VLSI Design',
  'Microwave Engineering & Antennas',
  'Embedded System Design & RTOS',
  'Wireless & 5G Mobile Communication',
  'SystemVerilog & UVM Verification (Industry Bridge)',
  'PCB Design & Hardware Prototyping (Industry Bridge)',
  'Electric Circuit Analysis',
  'DC Machines & Transformers',
  'Synchronous & Induction Machines (AC Machines)',
  'Electric Power Generation, Transmission & Distribution',
  'Electrical Measurements & Instrumentation',
  'Power Electronics',
  'Power System Analysis',
  'Power System Protection & Switchgear',
  'Electric Drives & Control',
  'Electric Vehicle (EV) Powertrain & BMS (Industry Bridge)',
  'Industrial Automation: PLC, SCADA & VFD (Industry Bridge)',
  'Solar PV Plant & Smart Grid Design (Industry Bridge)',
  'Mechanics of Materials (Strength of Materials)',
  'Basic & Applied Thermodynamics',
  'Material Science & Metallurgy',
  'Manufacturing Processes',
  'Fluid Mechanics & Hydraulic Machines',
  'Kinematics & Dynamics of Machinery',
  'Mechanical Measurements & Metrology',
  'Applied Thermal Engineering (IC Engines)',
  'Design of Machine Elements',
  'Heat and Mass Transfer (HMT)',
  'CAD/CAM, CNC & Additive Manufacturing',
  'Finite Element Analysis (FEA / ANSYS)',
  'Robotics & Industrial Automation',
  '3D CAD Modeling with SolidWorks / CATIA & GD&T (Industry Bridge)',
  'CFD & EV Battery Thermal Management (Industry Bridge)',
  'Building Materials & Construction Technology',
  'Surveying & Geomatics (Total Station & GIS)',
  'Structural Analysis',
  'Concrete Technology',
  'Geotechnical Engineering (Soil Mechanics & Foundation)',
  'Water Supply & Wastewater Engineering',
  'Highway & Transportation Engineering',
  'Design of Reinforced Concrete (RCC) Structures (IS 456)',
  'Design of Steel Structures (IS 800)',
  'Quantity Surveying, Estimation, Costing & BOQ',
  'Construction Planning & Project Management (Primavera P6)',
  '3D BIM Modeling with Autodesk Revit & Navisworks (Industry Bridge)',
  'High-Rise Structural Design with STAAD.Pro & ETABS (Industry Bridge)',
  'Data Structures and Applications',
  'Design and Analysis of Algorithms',
  'Object Oriented Programming using Java',
  'Database Management Systems (DBMS & SQL)',
  'Operating Systems & Linux Administration',
  'Computer Networks & Data Communication',
  'Software Engineering & Agile Practices',
  'Web Designing (HTML5, CSS3, JavaScript)',
  'Full-Stack Web Development (React.js, Node.js, MongoDB)',
  'Mobile Application Development (Flutter / React Native)',
  'Artificial Intelligence & Machine Learning',
  'Cloud Computing & DevOps (AWS / Docker)',
  'Cyber Security & Ethical Hacking Fundamentals',
  'Data Analytics & Power BI',
  'Generative AI & Large Language Models (LLMs)',
];

export const DEFAULT_BATCHES: string[] = [
  '2023-27',
  '2024-28',
  '2025-29',
  '2026-30',
  '2026-29',
  '2027-30',
];

export const DEFAULT_ACADEMIC_YEARS: string[] = [
  '1st Year',
  '2nd Year',
  '3rd Year',
  '4th Year',
];

export const DEFAULT_SEMESTERS: string[] = ['1', '2', '3', '4', '5', '6', '7', '8'];

export const SAMPLE_PROGRAM = 'B.E / B.Tech';
export const SAMPLE_COURSE = 'B.E / B.Tech (ECE)';
export const SAMPLE_DEPARTMENT = 'Electronics & Communication Engineering (ECE)';
export const SAMPLE_SUBJECT = 'Digital System Design (Verilog HDL)';
export const SAMPLE_SPECIALIZATION = 'VLSI & Embedded Systems';

export const DEPRECATED_TECH_BRANCHES: string[] = [];

export function withoutTechBranches(list: string[] | undefined | null): string[] {
  if (!list?.length) return [];
  return list.map((item) => String(item).trim()).filter(Boolean);
}
