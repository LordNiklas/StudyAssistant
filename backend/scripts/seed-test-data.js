const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { connectDB, pool, generateId } = require('../src/utils/pgDb');
const { extractContent } = require('../src/utils/contentExtractor');

const seedUsers = [
  {
    email: 'anna.public@local',
    username: 'AnnaPublic',
    password: 'test1234',
  },
  {
    email: 'ben.public@local',
    username: 'BenPublic',
    password: 'test1234',
  },
  {
    email: 'carla.public@local',
    username: 'CarlaPublic',
    password: 'test1234',
  },
  {
    email: 'peter.subscriber@local',
    username: 'PeterSubscriber',
    password: 'test1234',
  },
];

const subjects = [
  {
    ownerEmail: 'anna.public@local',
    name: 'Einfuhrung in Datenbanken',
    description: 'Relationale Modellierung, SQL-Grundlagen, Joins und Normalisierung.',
    lecturerName: 'Prof. Dr. Anna Weber',
    difficulty: 'medium',
    examNotes: 'Klausur fokussiert oft auf Normalformen, JOIN-Typen und Indizes.',
    isPublic: true,
    documents: [
      {
        name: 'SQL Grundlagen',
        originalFilename: 'sample.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', '1760791142698-sample.pdf'),
        content: 'SQL Grundlagen, SELECT, WHERE, JOIN, GROUP BY, Aggregation und Normalisierung.',
      },
    ],
  },
  {
    ownerEmail: 'ben.public@local',
    name: 'Algorithmen und Datenstrukturen',
    description: 'Sortierverfahren, Suchalgorithmen, Baeume, Listen und Komplexitaet.',
    lecturerName: 'Prof. Dr. Ben Kruger',
    difficulty: 'high',
    examNotes: 'Haeufig Klausuraufgaben zu Laufzeit, Rekursion und Baumtraversierung.',
    isPublic: true,
    documents: [
      {
        name: 'Algorithmen Uebung',
        originalFilename: 'sample.docx',
        fileType: 'docx',
        filePath: path.join(__dirname, '..', 'uploads', '1760791060400-sample.docx'),
        content: 'Big-O Notation, Binary Search, Merge Sort, Stack, Queue und Baumtraversierung.',
      },
      {
        name: 'Datenstrukturen Uebung',
        originalFilename: 'sample.txt',
        fileType: 'txt',
        filePath: path.join(__dirname, '..', 'uploads', '1760791064862-sample.txt'),
        content: 'Listen, Baeume, Hash Maps, Queues und typische Pruefungsfragen zu Datenstrukturen.',
      },
    ],
  },
  {
    ownerEmail: 'carla.public@local',
    name: 'Software Engineering Grundlagen',
    description: 'Anforderungen, Architektur, Tests, Git und agile Methoden.',
    lecturerName: 'Prof. Dr. Carla Schmitt',
    difficulty: 'low',
    examNotes: 'Pruefungsfragen sind oft anwendungsnah und kurz formuliert.',
    isPublic: true,
    documents: [
      {
        name: 'SE Grundlagen',
        originalFilename: 'sample.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', '1760790209870-sample.pdf'),
        content: 'Anforderungen, UML, Testing, Git-Workflows, Scrum, Architektur und Refactoring.',
      },
    ],
  },
  {
    ownerEmail: 'peter.subscriber@local',
    name: 'Betriebswirtschaft intern',
    description: 'Private Lernnotizen fuer betriebswirtschaftliche Grundlagen.',
    lecturerName: 'Prof. Dr. Peter Hahn',
    difficulty: 'medium',
    examNotes: 'Nicht oeffentlich, dient nur zum Testen von Private/Read-Only-Trennung.',
    isPublic: false,
    documents: [
      {
        name: 'BWL Notizen',
        originalFilename: 'sample.docx',
        fileType: 'docx',
        filePath: path.join(__dirname, '..', 'uploads', '1760791179250-sample.docx'),
        content: '',
      },
    ],
  },
  {
    ownerEmail: 'anna.public@local',
    name: 'Mathematik 2 - Statistik und Operations Research',
    description: 'Grundlagen der Statistik mit deskriptiver und induktiver Statistik sowie Operations Research.',
    lecturerName: 'Prof. Dr. Sarah Detzler',
    difficulty: 'high',
    examNotes: 'Zentrale Themen sind Grundbegriffe der Statistik, Lage- und Streuungsmasse, Verteilungen, lineare Programmierung und Simplex.',
    isPublic: true,
    documents: [
      {
        name: 'Statistik_d2b4119e707c6674ccdeb6c8aba605e9.pdf',
        originalFilename: 'Statistik_d2b4119e707c6674ccdeb6c8aba605e9.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', 'Statistik_d2b4119e707c6674ccdeb6c8aba605e9.pdf'),
        content: '',
      },
      {
        name: 'or_766765fc9bdeee6fe686e84f09a07144.pdf',
        originalFilename: 'or_766765fc9bdeee6fe686e84f09a07144.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', 'or_766765fc9bdeee6fe686e84f09a07144.pdf'),
        content: '',
      },
    ],
  },
  {
    ownerEmail: 'ben.public@local',
    name: 'Mathematik 2 - Analysis',
    description: 'Kurvendiskussion und Extremwertaufgaben mit Schwerpunkt auf Analysis.',
    lecturerName: 'Karl Bosch',
    difficulty: 'high',
    examNotes: 'Typische Aufgaben sind Symmetrie, Definitionsbereich, Extrempunkte und Wendepunkte.',
    isPublic: true,
    documents: [
      {
        name: 'Kurvendiskussion_53e88fc41101d10aa903f2b819caf19a.pdf',
        originalFilename: 'Kurvendiskussion_53e88fc41101d10aa903f2b819caf19a.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', 'Kurvendiskussion_53e88fc41101d10aa903f2b819caf19a.pdf'),
        content: '',
      },
      {
        name: 'Extremwertaufgaben einer einzigen Variahlen_41e9cd076d67b5a21ba5b6c32f943b5b.pdf',
        originalFilename: 'Extremwertaufgaben einer einzigen Variahlen_41e9cd076d67b5a21ba5b6c32f943b5b.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', 'Extremwertaufgaben einer einzigen Variahlen_41e9cd076d67b5a21ba5b6c32f943b5b.pdf'),
        content: '',
      },
    ],
  },
  {
    ownerEmail: 'peter.subscriber@local',
    name: 'PA3 Prep - BWL und Rechnungswesen',
    description: 'Vorbereitungsmaterial zu BWL, Unternehmensfuehrung, Kostenrechnung, Bilanzierung und Abschreibung.',
    lecturerName: 'keine Angabe',
    difficulty: 'medium',
    examNotes: 'Geeignet fuer Klausurvorbereitung in BWL, Rechnungswesen, Investitionsrechnung und Personalthemen.',
    isPublic: true,
    documents: [
      {
        name: 'PA3_Prep.pdf',
        originalFilename: 'PA3_Prep.pdf',
        fileType: 'pdf',
        filePath: path.join(__dirname, '..', 'uploads', 'PA3_Prep.pdf'),
        content: '',
      },
    ],
  },
];

const subscriptions = [
  {
    subscriberEmail: 'peter.tester@local',
    subjectName: 'Einfuhrung in Datenbanken',
  },
  {
    subscriberEmail: 'peter.tester@local',
    subjectName: 'Algorithmen und Datenstrukturen',
  },
  {
    subscriberEmail: 'peter.subscriber@local',
    subjectName: 'Einfuhrung in Datenbanken',
  },
  {
    subscriberEmail: 'peter.tester@local',
    subjectName: 'Mathematik 2 - Statistik und Operations Research',
  },
  {
    subscriberEmail: 'peter.tester@local',
    subjectName: 'Mathematik 2 - Analysis',
  },
];

const cleanupEmails = [
  'anna.public@local',
  'ben.public@local',
  'carla.public@local',
  'peter.subscriber@local',
];

const isExtractionFailure = (value) => {
  if (!value || typeof value !== 'string') return true;
  return value.startsWith('[CONTENT EXTRACTION FAILED:') ||
    value.startsWith('[TXT CONTENT EXTRACTION FAILED:') ||
    value.startsWith('[DOCX CONTENT EXTRACTION FAILED:') ||
    value.startsWith('[PDF CONTENT EXTRACTION FAILED:') ||
    value.startsWith('[UNSUPPORTED FILE TYPE:');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractWithRetries(doc) {
  const maxAttempts = doc.fileType === 'pdf' ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const extracted = await extractContent(doc.filePath, doc.fileType);
    if (!isExtractionFailure(extracted) && extracted.trim().length > 0) {
      return extracted;
    }

    if (attempt < maxAttempts) {
      await sleep(200 * attempt);
    }
  }

  return '';
}

async function hydrateSubjectsWithRealDocumentContent(subjectList) {
  const hydratedSubjects = [];

  for (const subject of subjectList) {
    const hydratedDocuments = [];

    for (const doc of subject.documents || []) {
      let hydratedContent = '';

      if (doc.filePath && fs.existsSync(doc.filePath)) {
        const stats = fs.statSync(doc.filePath);
        if (stats.size > 0) {
          hydratedContent = await extractWithRetries(doc);
        }
      }

      hydratedDocuments.push({
        ...doc,
        content: hydratedContent,
      });
    }

    hydratedSubjects.push({
      ...subject,
      documents: hydratedDocuments,
    });
  }

  return hydratedSubjects;
}

async function ensureUser(client, { email, username, password }) {
  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await client.query(
    'INSERT INTO users (email, username, password_hash, created_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
    [email, username, passwordHash]
  );
  return result.rows[0].id;
}

async function ensureSubject(client, ownerId, subject) {
  const existing = await client.query('SELECT id FROM subjects WHERE name = $1', [subject.name]);
  if (existing.rows[0]) {
    await client.query(
      'UPDATE subjects SET description = $1, lecturer_name = $2, difficulty = $3, exam_notes = $4, is_public = $5, user_id = $6 WHERE id = $7',
      [subject.description, subject.lecturerName, subject.difficulty, subject.examNotes, subject.isPublic, ownerId, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  const subjectId = generateId();
  await client.query(
    'INSERT INTO subjects (id, name, description, lecturer_name, difficulty, exam_notes, user_id, is_public, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [subjectId, subject.name, subject.description, subject.lecturerName, subject.difficulty, subject.examNotes, ownerId, subject.isPublic]
  );
  return subjectId;
}

async function ensureDocument(client, subjectId, doc) {
  const existing = await client.query('SELECT id FROM documents WHERE subject_id = $1 AND name = $2', [subjectId, doc.name]);
  if (existing.rows[0]) {
    await client.query(
      'UPDATE documents SET original_filename = $1, file_type = $2, file_path = $3, content = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
      [doc.originalFilename, doc.fileType, doc.filePath, doc.content, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  const documentId = generateId();
  await client.query(
    'INSERT INTO documents (id, name, original_filename, file_type, file_path, content, subject_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [documentId, doc.name, doc.originalFilename, doc.fileType, doc.filePath, doc.content, subjectId]
  );
  return documentId;
}

async function ensureSubscription(client, subjectId, subscriberId) {
  const existing = await client.query(
    'SELECT id FROM subject_subscriptions WHERE subject_id = $1 AND subscriber_user_id = $2',
    [subjectId, subscriberId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const subscriptionId = generateId();
  await client.query(
    'INSERT INTO subject_subscriptions (id, subject_id, subscriber_user_id, permission, subscribed_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
    [subscriptionId, subjectId, subscriberId, 'read_only']
  );
  return subscriptionId;
}

async function cleanupSeedData(client) {
  const cleanupUsersResult = await client.query(
    'SELECT id FROM users WHERE email = ANY($1::text[])',
    [cleanupEmails]
  );

  const cleanupUserIds = cleanupUsersResult.rows.map((row) => row.id);
  if (cleanupUserIds.length === 0) return;

  const ownedSubjectsResult = await client.query(
    'SELECT id FROM subjects WHERE user_id = ANY($1::int[])',
    [cleanupUserIds]
  );
  const ownedSubjectIds = ownedSubjectsResult.rows.map((row) => row.id);

  // user_answers.question_id references assessment_questions without ON DELETE CASCADE.
  // Remove dependent answers first for questions tied to cleanup users/subjects.
  await client.query(
    `DELETE FROM user_answers ua
     USING assessment_questions aq
     WHERE ua.question_id = aq.id
       AND (
         aq.user_id = ANY($1::int[])
         OR aq.subject_id = ANY($2::text[])
       )`,
    [cleanupUserIds, ownedSubjectIds.length > 0 ? ownedSubjectIds : ['']]
  );

  // Remove subscriptions where cleanup users are subscribers.
  await client.query(
    'DELETE FROM subject_subscriptions WHERE subscriber_user_id = ANY($1::int[])',
    [cleanupUserIds]
  );

  // Remove subjects owned by cleanup users (cascades to documents and other subject-bound data).
  await client.query(
    'DELETE FROM subjects WHERE user_id = ANY($1::int[])',
    [cleanupUserIds]
  );

  // Finally remove the users themselves.
  await client.query(
    'DELETE FROM users WHERE id = ANY($1::int[])',
    [cleanupUserIds]
  );
}

async function main() {
  await connectDB();
  const client = await pool.connect();
  const hydratedSubjects = await hydrateSubjectsWithRealDocumentContent(subjects);

  try {
    await client.query('BEGIN');

    // Remove old seed data so the script is repeatable.
    await cleanupSeedData(client);

    const userIds = {};
    for (const user of seedUsers) {
      userIds[user.email] = await ensureUser(client, user);
    }

    const subjectIds = {};
    for (const subject of hydratedSubjects) {
      subjectIds[subject.name] = await ensureSubject(client, userIds[subject.ownerEmail], subject);
      for (const doc of subject.documents || []) {
        await ensureDocument(client, subjectIds[subject.name], doc);
      }
    }

    const peterId = await ensureUser(client, {
      email: 'peter.tester@local',
      username: 'PeterTester',
      password: 'tester123',
    });

    for (const subscription of subscriptions) {
      await ensureSubscription(client, subjectIds[subscription.subjectName], userIds[subscription.subscriberEmail] || peterId);
    }

    await client.query('COMMIT');

    console.log('Seed data created successfully.');
    console.log('Test login: peter.tester@local / tester123');
    console.log('Useful public subjects:');
    console.log('- Einfuhrung in Datenbanken');
    console.log('- Algorithmen und Datenstrukturen');
    console.log('- Software Engineering Grundlagen');
    console.log('- Mathematik 2 - Statistik und Operations Research');
    console.log('- Mathematik 2 - Analysis');
    console.log('- PA3 Prep - BWL und Rechnungswesen');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to create seed data:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
