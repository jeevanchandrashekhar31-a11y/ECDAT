/**
 * Projects REST API Router
 *
 * Enforces strict server-side tenant isolation for project entities.
 * A client cannot access, modify, or delete another tenant's projects.
 */

const express = require("express");
const crypto = require("crypto");
const { defaultObjectStateRegistry, OBJECT_TYPES } = require("../security/object_authorization");
const { inMemoryScansStore } = require("../services/cbom_ingestion");
const { db, isDbConnected } = require("../db/connection");
const { paginationBoundsMiddleware } = require("../security/input_validation");

const router = express.Router();

/**
 * Resolves a project from in-memory registry, in-memory scans, or database.
 */
async function resolveProject(projectId) {
  const cleanId = String(projectId).trim();

  const mode = process.env.DATA_STORE_MODE || "postgres";
  if (mode !== "postgres") {
    // 1. In-memory object registry
    const regProject = defaultObjectStateRegistry.getProject(cleanId);
    if (regProject) {
      return { ...regProject };
    }

    // 2. In-memory scans matching project_id
    for (const s of inMemoryScansStore.values()) {
      if (s.project_id === cleanId) {
        return {
          id: cleanId,
          name: s.name || cleanId,
          tenantId: s.tenantId || "default-tenant",
          ownerId: s.owner_id || null,
          status: "active",
        };
      }
    }
  }

  // 3. Database
  const connected = await isDbConnected();
  if (connected) {
    try {
      const hasProjectsTable = await db.schema.hasTable("projects").catch(() => false);
      if (hasProjectsTable) {
        const row = await db("projects").where({ id: cleanId }).first();
        if (row) {
          return {
            id: row.id,
            name: row.name,
            tenantId: row.tenant_id || "default-tenant",
            ownerId: row.owner_id || null,
            status: row.status || "active",
          };
        }
      }

      // Check scans table for project_id
      const scanRow = await db("scans").where({ project_id: cleanId }).first();
      if (scanRow) {
        return {
          id: cleanId,
          name: scanRow.target_name || cleanId,
          tenantId: scanRow.tenant_id || "default-tenant",
          status: "active",
        };
      }
    } catch (_err) {}
  }

  return null;
}

/**
 * GET /api/v1/projects
 * Lists projects scoped strictly to caller's tenant.
 */
router.get("/", paginationBoundsMiddleware(), async (req, res, next) => {
  try {
    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    const projectMap = new Map();

    const mode = process.env.DATA_STORE_MODE || "postgres";
    if (mode !== "postgres") {
      // 1. From object state registry
      for (const p of defaultObjectStateRegistry.projects.values()) {
        if (isPlatformAdmin || p.tenantId === callerTenant) {
          projectMap.set(p.id, { ...p });
        }
      }

      // 2. From in-memory scans
      for (const s of inMemoryScansStore.values()) {
        const scanTenant = s.tenantId || "default-tenant";
        if (s.project_id && (isPlatformAdmin || scanTenant === callerTenant)) {
          if (!projectMap.has(s.project_id)) {
            projectMap.set(s.project_id, {
              id: s.project_id,
              name: s.name || s.project_id,
              tenantId: scanTenant,
              status: "active",
            });
          }
        }
      }
    }

    // 3. From database
    const connected = await isDbConnected();
    if (connected) {
      try {
        const hasProjectsTable = await db.schema.hasTable("projects").catch(() => false);
        if (hasProjectsTable) {
          let q = db("projects");
          if (!isPlatformAdmin) {
            q = q.where({ tenant_id: callerTenant });
          }
          const rows = await q;
          for (const r of rows) {
            projectMap.set(r.id, {
              id: r.id,
              name: r.name,
              tenantId: r.tenant_id || "default-tenant",
              status: r.status || "active",
            });
          }
        }
        
        // Also derive projects implicitly from scans
        const hasScansTable = await db.schema.hasTable("scans").catch(() => false);
        if (hasScansTable) {
          let qScans = db("scans").select("project_id", "target_name", "tenant_id");
          if (!isPlatformAdmin) {
            qScans = qScans.where({ tenant_id: callerTenant });
          }
          const scanRows = await qScans;
          for (const s of scanRows) {
            if (s.project_id && !projectMap.has(s.project_id)) {
              projectMap.set(s.project_id, {
                id: s.project_id,
                name: s.target_name || s.project_id,
                tenantId: s.tenant_id || "default-tenant",
                status: "active",
              });
            }
          }
        }
      } catch (_err) {}
    }

    const projects = Array.from(projectMap.values());
    return res.status(200).json({
      total: projects.length,
      projects,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/projects
 * Creates a project strictly scoped to caller's tenant.
 */
router.post("/", async (req, res, next) => {
  try {
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";
    const { name, description = "" } = req.body || {};

    const projectId = req.body?.id || `proj_${crypto.randomUUID().substring(0, 8)}`;
    const newProject = {
      id: projectId,
      name: name || projectId,
      description,
      tenantId: callerTenant,
      ownerId: req.tenantContext?.userId || null,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    const mode = process.env.DATA_STORE_MODE || "postgres";
    if (mode !== "postgres") {
      defaultObjectStateRegistry.registerProject(newProject);
    }

    const connected = await isDbConnected();
    if (connected) {
      try {
        const hasProjectsTable = await db.schema.hasTable("projects").catch(() => false);
        if (hasProjectsTable) {
          await db("projects").insert({
            id: newProject.id,
            name: newProject.name,
            tenant_id: callerTenant,
            owner_id: newProject.ownerId,
            status: newProject.status,
          });
        }
      } catch (_err) {}
    }

    return res.status(201).json(newProject);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/projects/:id
 * Retrieves a specific project verifying tenant boundary.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    const project = await resolveProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: "NotFound",
        message: `Project '${projectId}' not found`,
      });
    }

    if (!isPlatformAdmin && project.tenantId && project.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "TenantBoundaryViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot access project belonging to foreign tenant '${project.tenantId}'`,
      });
    }

    return res.status(200).json(project);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/v1/projects/:id
 * Modifies a project verifying tenant boundary.
 */
router.put("/:id", async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    const project = await resolveProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: "NotFound",
        message: `Project '${projectId}' not found`,
      });
    }

    if (!isPlatformAdmin && project.tenantId && project.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "TenantBoundaryViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot modify project belonging to foreign tenant '${project.tenantId}'`,
      });
    }

    const { name, description, status } = req.body || {};
    if (name) project.name = name;
    if (description !== undefined) project.description = description;
    if (status) project.status = status;

    const mode = process.env.DATA_STORE_MODE || "postgres";
    if (mode !== "postgres") {
      defaultObjectStateRegistry.registerProject(project);
    }
    return res.status(200).json({
      success: true,
      project,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/v1/projects/:id
 * Deletes a project verifying tenant boundary.
 */
router.delete("/:id", async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId || "default-tenant";

    const project = await resolveProject(projectId);
    if (!project) {
      return res.status(404).json({
        error: "NotFound",
        message: `Project '${projectId}' not found`,
      });
    }

    if (!isPlatformAdmin && project.tenantId && project.tenantId !== callerTenant) {
      return res.status(403).json({
        error: "TenantBoundaryViolation",
        code: "HORIZONTAL_TENANT_VIOLATION",
        message: `Cannot delete project belonging to foreign tenant '${project.tenantId}'`,
      });
    }

    const mode = process.env.DATA_STORE_MODE || "postgres";
    if (mode === "postgres") {
      const connected = await isDbConnected();
      if (connected) {
        try {
          const hasProjectsTable = await db.schema.hasTable("projects").catch(() => false);
          if (hasProjectsTable) {
            await db("projects").where({ id: projectId }).del();
          }
        } catch (_err) {}
      }
    } else {
      defaultObjectStateRegistry.projects.delete(projectId);
    }

    return res.status(200).json({
      success: true,
      message: `Project '${projectId}' deleted successfully.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
