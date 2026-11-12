import { eq, desc, and } from "drizzle-orm";
import { db } from "@/db";
import { services, purposes, serviceRequests } from "@/db/schema";
import { randomUUID } from "node:crypto";

const DEFAULT_SERVICES = [
  { id: 1, code: "TOR", name: "Transcript of Records", description: "Official copy of academic transcript", fee: 150, active: true },
  { id: 2, code: "COG", name: "Certificate of Graduation", description: "Official certificate confirming graduation", fee: 100, active: true },
  { id: 3, code: "COE", name: "Certificate of Enrollment", description: "Certifies current enrollment status", fee: 50, active: true },
  { id: 4, code: "GRC", name: "Good Moral Certificate", description: "Certificate of good moral character", fee: 50, active: true },
  { id: 5, code: "CERT_GRADES", name: "Certified True Copy of Grades", description: "Certified copy of grades per semester", fee: 75, active: true },
];

const DEFAULT_PURPOSES = [
  { id: 1, label: "Employment", sortOrder: 0 },
  { id: 2, label: "Scholarship", sortOrder: 1 },
  { id: 3, label: "School Requirement", sortOrder: 2 },
  { id: 4, label: "Personal Use", sortOrder: 3 },
  { id: 5, label: "Board Exam", sortOrder: 4 },
  { id: 6, label: "Other", sortOrder: 5 },
];

const memRequests: any[] = [];

export class ServiceCatalogRepository {
  async getAllServices() {
    try {
      const svcs = await db.select().from(services).where(eq(services.active, true));
      if (svcs && svcs.length > 0) return svcs;
    } catch {
      // Fall through to memory
    }
    return DEFAULT_SERVICES;
  }

  async getAllPurposes() {
    try {
      const purps = await db.select().from(purposes).orderBy(purposes.sortOrder);
      if (purps && purps.length > 0) return purps;
    } catch {
      // Fall through to memory
    }
    return DEFAULT_PURPOSES;
  }

  async findServiceById(id: number) {
    try {
      const [svc] = await db.select().from(services).where(eq(services.id, id)).limit(1);
      if (svc) return svc;
    } catch {
      // Fall through to memory
    }
    return DEFAULT_SERVICES.find((s) => s.id === id) ?? null;
  }

  async seedCatalogIfEmpty() {
    try {
      const existing = await db.select({ id: services.id }).from(services).limit(1);
      if (existing.length > 0) return;

      await db.insert(services).values([
        { code: "TOR", name: "Transcript of Records", description: "Official copy of academic transcript", fee: 150 },
        { code: "COG", name: "Certificate of Graduation", description: "Official certificate confirming graduation", fee: 100 },
        { code: "COE", name: "Certificate of Enrollment", description: "Certifies current enrollment status", fee: 50 },
        { code: "GRC", name: "Good Moral Certificate", description: "Certificate of good moral character", fee: 50 },
        { code: "CERT_GRADES", name: "Certified True Copy of Grades", description: "Certified copy of grades per semester", fee: 75 },
      ]);

      const existingPurposes = await db.select({ id: purposes.id }).from(purposes).limit(1);
      if (existingPurposes.length > 0) return;

      await db.insert(purposes).values([
        { label: "Employment", sortOrder: 0 },
        { label: "Scholarship", sortOrder: 1 },
        { label: "School Requirement", sortOrder: 2 },
        { label: "Personal Use", sortOrder: 3 },
        { label: "Board Exam", sortOrder: 4 },
        { label: "Other", sortOrder: 5 },
      ]);
    } catch {
      // In-memory defaults already in place
    }
  }
}

export class ServiceRequestRepository {
  async findByUserId(userId: string) {
    try {
      const rows = await db
        .select({
          id: serviceRequests.id,
          referenceNumber: serviceRequests.referenceNumber,
          copies: serviceRequests.copies,
          purpose: serviceRequests.purpose,
          notes: serviceRequests.notes,
          status: serviceRequests.status,
          remarks: serviceRequests.remarks,
          submittedAt: serviceRequests.submittedAt,
          updatedAt: serviceRequests.updatedAt,
          service: {
            id: services.id,
            name: services.name,
            code: services.code,
            fee: services.fee,
          },
        })
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .where(eq(serviceRequests.userId, userId))
        .orderBy(desc(serviceRequests.submittedAt));
      if (rows && rows.length > 0) return rows;
    } catch {
      // Fall through to memory
    }

    return memRequests
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  async findByIdAndUserId(id: string, userId: string) {
    try {
      const [req] = await db
        .select({
          id: serviceRequests.id,
          referenceNumber: serviceRequests.referenceNumber,
          copies: serviceRequests.copies,
          purpose: serviceRequests.purpose,
          notes: serviceRequests.notes,
          status: serviceRequests.status,
          remarks: serviceRequests.remarks,
          submittedAt: serviceRequests.submittedAt,
          updatedAt: serviceRequests.updatedAt,
          service: {
            id: services.id,
            name: services.name,
            code: services.code,
            fee: services.fee,
          },
        })
        .from(serviceRequests)
        .innerJoin(services, eq(serviceRequests.serviceId, services.id))
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.userId, userId)))
        .limit(1);
      if (req) return req;
    } catch {
      // Fall through to memory
    }

    return memRequests.find((r) => r.id === id && r.userId === userId) ?? null;
  }

  async getTotalCount(): Promise<number> {
    try {
      const rows = await db.select({ id: serviceRequests.id }).from(serviceRequests);
      return rows.length;
    } catch {
      return memRequests.length;
    }
  }

  async create(data: {
    referenceNumber: string;
    userId: string;
    serviceId: number;
    copies: number;
    purpose: string;
    notes: string;
  }) {
    const now = new Date().toISOString();
    try {
      const [created] = await db
        .insert(serviceRequests)
        .values(data)
        .returning();
      if (created) return created;
    } catch {
      // Fall through to memory
    }

    const svc = DEFAULT_SERVICES.find((s) => s.id === data.serviceId);
    const created = {
      id: randomUUID(),
      ...data,
      status: "submitted",
      remarks: null,
      submittedAt: now,
      updatedAt: now,
      service: svc ? { id: svc.id, name: svc.name, code: svc.code, fee: svc.fee } : null,
    };
    memRequests.push(created);
    return created;
  }
}
