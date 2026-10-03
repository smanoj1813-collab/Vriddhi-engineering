import { getFirestore } from 'firebase-admin/firestore';
import { getApps, initializeApp } from 'firebase-admin/app';
if (!getApps().length) initializeApp();
// src/routes/questions.ts
import express from 'express'
import admin from 'firebase-admin'

const router = express.Router()

// Initialize Firebase Admin (do this once in a real app, ideally in index.ts)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    } as admin.ServiceAccount),
  })
}

const db = getFirestore(admin.app(), 'default')

// ─── POST /api/questions ─── (Create question)
router.post('/', async (req, res) => {
  try {
    const questionData = req.body
    const docRef = await db.collection('questions').add({
      ...questionData,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    })
    res.json({ id: docRef.id, ...questionData })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ─── POST /api/questions/bulk ─── (Bulk create)
router.post('/bulk', async (req, res) => {
  try {
    const { questions, collegeId } = req.body
    const batch = db.batch()
    const savedIds: string[] = []

    for (const q of questions) {
      const docRef = db.collection('questions').doc()
      batch.set(docRef, {
        ...q,
        collegeId,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
      })
      savedIds.push(docRef.id)
    }

    await batch.commit()
    res.json({ success: true, savedCount: savedIds.length, ids: savedIds })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// ─── GET /api/questions ─── (List with filters)
router.get('/', async (req, res) => {
  try {
    let query: any = db.collection('questions').orderBy('createdAt', 'desc')

    if (req.query.collegeId) {
      query = query.where('collegeId', '==', req.query.collegeId)
    }
    if (req.query.subject) {
      query = query.where('subject', '==', req.query.subject)
    }
    if (req.query.type) {
      query = query.where('type', '==', req.query.type)
    }

    const snapshot = await query.limit(50).get()
    const questions = snapshot.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }))

    res.json(questions)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router