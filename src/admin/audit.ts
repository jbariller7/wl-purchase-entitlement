import type { Firestore } from "firebase-admin/firestore";

export interface AdminActor {
  uid: string;
  email: string;
}

export async function recordAdminAudit(input: {
  db: Firestore;
  actor: AdminActor;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  metadata?: Record<string, unknown>;
  now: Date;
}): Promise<string> {
  const ref = input.db.collection("adminAudit").doc();
  await ref.create({
    id: ref.id,
    actorUid: input.actor.uid,
    actorEmail: input.actor.email,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary: input.summary,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: input.now.toISOString()
  });
  return ref.id;
}
