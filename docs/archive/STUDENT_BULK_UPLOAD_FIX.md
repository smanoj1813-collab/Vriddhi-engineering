> **SUPERSEDED (2026-09-04) — read `docs/AUTH_LOGIN_PROVISIONING_AUDIT_2026-09-04.md`.**
> The problem statement below is accurate; the “Solution Implemented” section is the code that
> **caused** the next round of failures and it no longer exists in the tree:
> * `createFirebaseAuthUser(...)` called the Identity Toolkit REST API from the browser. That
>   cannot set custom claims, so every account it created signed in and was then denied every
>   rule-guarded read — the “students exist in Firestore but are not usable logins” state, and it
>   also required a Web API key reachable from the client to create users.
> * `setDoc(..., { password: tempPassword })` wrote a plaintext credential onto `students/{id}`,
>   a document readable by same-college staff. That is why a password could only be recovered by
>   opening Firestore; `noPasswordField()` in the rules now rejects such a write, and the
>   provisioning callables delete any of these fields they find.
> * The loop validated duplicates against Firestore only and short-circuited rows whose email
>   already existed, so an orphaned Firestore row could never produce a credential. Reclaim
>   (`onExisting: 'reset'`) and the per-row `status`/`authVerified` fields replace that behaviour.
> Student provisioning is now: `importUsers` → `bulkCreateStudentAccounts` (Admin SDK) → Auth
> user + claims + `users/{uid}.studentDocId` + college mirror + verified read-back → credentials
> displayed once in `CredentialsTable` (or delivered as a reset link).

# Student Bulk Upload Fix — Auth Login Creation

## 🐛 Problem Identified

The student bulk upload feature was **not creating Firebase Auth accounts**, which meant students could not log in to the system even though their records were created in Firestore.

### Root Cause

The `importUsers` function in `src/modules/superadmin/api/superAdminApi.ts` was only:
- ✅ Writing student records to the `students` Firestore collection
- ❌ **NOT creating Firebase Auth accounts**
- ❌ **NOT generating passwords**
- ❌ **NOT writing to the `users` collection** (used for role-based routing)
- ❌ **NOT storing `uid` in the student document**

Compare this with `importFaculty` which correctly handles all four steps.

---

## ✅ Solution Implemented

### 1. **Rewrote `importUsers` function** (`superAdminApi.ts`)

The function now:

```typescript
for (const [index, user] of input.users.entries()) {
  // 1. Validate required fields (email, name)
  // 2. Check for duplicate emails in Firestore
  // 3. Generate a secure 10-character password
  const tempPassword = generateTempPassword();
  
  // 4. Create Firebase Auth account via REST API
  const uid = await createFirebaseAuthUser(email, tempPassword);
  
  // 5. Write student record to Firestore with uid + password
  await setDoc(docRef, {
    ...user,
    email,
    collegeId: input.collegeId,
    collegeName,
    uid,
    password: tempPassword,
    role: user.role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  
  // 6. Create users/ lookup document for role-based routing
  await setDoc(doc(db, "users", uid), {
    uid,
    email,
    name: user.name,
    role: user.role,
    collegeId: input.collegeId,
    // ...
  });
  
  // 7. Track imported users with passwords
  imported.push({ id: docRef.id, email, password: tempPassword });
}
```

**Key improvements:**
- Creates Firebase Auth accounts using the REST API (doesn't affect current session)
- Generates secure 10-character passwords for each student
- Stores `uid` and `password` in Firestore for credential distribution
- Creates `users` collection entries for role-based routing
- Checks for duplicate emails before import
- Returns passwords in the response so admins can share them

### 2. **Enhanced `UserImport.tsx` UI**

Added a **credentials table** that displays:
- ✅ Email addresses
- ✅ Generated passwords (with show/hide toggle)
- ✅ Firestore document IDs
- ✅ Download CSV button for credential distribution

**New features:**
```tsx
<button onClick={() => setShowPasswords(!showPasswords)}>
  {showPasswords ? 'Hide' : 'Show'} Passwords
</button>

<button onClick={() => downloadCSV(importResult.imported)}>
  Download CSV
</button>
```

### 3. **Updated TypeScript types** (`superAdmin.ts`)

Extended `ImportUserEntry` to include additional fields:
```typescript
export interface ImportUserEntry {
  name: string;
  email: string;
  regNo?: string;
  role: "student" | "faculty";
  batch?: string;
  division?: string;
  phone?: string;
  mentor?: string;
  department?: string;
  semester?: number;  // NEW
  dob?: string;       // NEW
  gender?: string;    // NEW
  address?: string;   // NEW
}
```

### 4. **Fixed sidebar navigation path** (`Sidebar.tsx`)

Changed from `/superadmin/user-import` to `/superadmin/students/import` to match the actual route.

---

## 📊 Files Modified

1. **`src/modules/superadmin/api/superAdminApi.ts`**
   - Rewrote `importUsers` to create Firebase Auth accounts
   - Added password generation and storage
   - Added `users` collection writes
   - Added duplicate email checking

2. **`src/modules/superadmin/pages/UserImport.tsx`**
   - Added credentials table with show/hide passwords
   - Added CSV download for credentials
   - Improved import result UI

3. **`src/modules/superadmin/types/superAdmin.ts`**
   - Extended `ImportUserEntry` with `semester`, `dob`, `gender`, `address`

4. **`src/shared/components/Sidebar.tsx`**
   - Fixed route path from `/superadmin/user-import` to `/superadmin/students/import`
   - Renamed label from "User Import" to "Student Import"

---

## ✅ Build Status

```bash
$ npm run build
✓ TypeScript: 0 errors
✓ Vite: 0 errors
✓ Build completed in 24.57s
```

**Ready for deployment via `firebase deploy --only hosting`**

---

## 🧪 Testing Checklist

After deployment, verify:

- [ ] Upload a CSV with 5-10 students
- [ ] Check that Firebase Auth accounts are created (Firebase Console → Authentication → Users)
- [ ] Check that `students` collection has records with `uid` and `password` fields
- [ ] Check that `users` collection has entries for each student
- [ ] Verify the credentials table shows emails and passwords
- [ ] Download the CSV and verify it contains all credentials
- [ ] **Test login**: Use one of the generated email/password combinations to log in via `/login` (Student tab)
- [ ] Verify the student is routed to `/student/dashboard`

---

## 🔐 Security Notes

- Temporary passwords are generated with `crypto.randomInt` / Web Crypto — never `Math.random`.
- **Do not write plaintext passwords to Firestore**, logs, or persistent browser history.
- Prefer Firebase password-reset / onboarding emails.
- If a temporary password is required, return it **once** to an authorized admin and force a change at first login (`mustChangePassword` custom claim).
- Client-side role assignment is forbidden; use the `provisionUser` / `bulkCreateStudentAccounts` Cloud Functions.

---

## 📝 Example CSV Format

```csv
name,email,regNo,phone,department,batch,division,semester,dob,gender,address
John Doe,john.doe@example.com,REG001,9876543210,B.Com,2026,A,3,2002-05-15,Male,123 Main St
Jane Smith,jane.smith@example.com,REG002,9876543211,B.Sc,2026,B,3,2002-08-20,Female,456 Oak Ave
```

---

## 🚀 Next Steps

1. Deploy to Firebase Hosting
2. Test with a small batch (5 students)
3. Verify login works for imported students
4. Scale up to full class imports

---

**Fixed by:** Arena.ai Agent  
**Date:** 2026-08-23  
**Branch:** `arena/01a02e82-vriddhi`
