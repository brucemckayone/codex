# Deprecated Documentation

**Status**: Archive folder for superseded documentation
**Last Updated**: 2025-11-04

---

## Purpose

This folder contains documentation that has been superseded by the new consolidated structure. These files are kept for historical reference and to ensure no information is lost during the reorganization.

---

## Why These Files Were Deprecated

As part of the documentation consolidation effort (feature/doc-tidy), we moved from a PRD+TDD pattern to an **EVOLUTION.md + IMPLEMENTATION.md** pattern for all features:

- **EVOLUTION.md**: Long-term vision showing how features evolve from Phase 1→4+
- **IMPLEMENTATION.md**: Consolidated Phase 1 implementation guide (replaces PRD + TDD)

This new pattern reduces duplication, provides better context, and creates a single source of truth for each feature's design and implementation.

---

## Files in This Folder

### Superseded by IMPLEMENTATION.md
These PRD (Product Requirements Document) and TDD (Technical Design Document) files were consolidated into feature-specific IMPLEMENTATION.md files:

- `auth/pdr-phase-1.md` → See `/design/features/auth/IMPLEMENTATION.md`
- `auth/ttd-dphase-1.md` → See `/design/features/auth/IMPLEMENTATION.md`
- `content-management/pdr-phase-1.md` → See `/design/features/content-management/IMPLEMENTATION.md`
- `content-management/ttd-dphase-1.md` → See `/design/features/content-management/IMPLEMENTATION.md`
- `content-access/pdr-phase-1.md` → See `/design/features/content-access/IMPLEMENTATION.md`
- `content-access/ttd-dphase-1.md` → See `/design/features/content-access/IMPLEMENTATION.md`
- `e-commerce/pdr-phase-1.md` → See `/design/features/e-commerce/IMPLEMENTATION.md`
- `e-commerce/ttd-dphase-1.md` → See `/design/features/e-commerce/IMPLEMENTATION.md`
- `admin-dashboard/pdr-phase-1.md` → See `/design/features/admin-dashboard/IMPLEMENTATION.md`
- `admin-dashboard/ttd-dphase-1.md` → See `/design/features/admin-dashboard/IMPLEMENTATION.md`
- `platform-settings/pdr-phase-1.md` → See `/design/features/platform-settings/IMPLEMENTATION.md`
- `platform-settings/ttd-dphase-1.md` → See `/design/features/platform-settings/IMPLEMENTATION.md`
- `notifications/pdr-phase-1.md` → See `/design/features/notifications/IMPLEMENTATION.md`
- `notifications/ttd-dphase-1.md` → See `/design/features/notifications/IMPLEMENTATION.md`

---

## Do Not Delete

**Important**: These files should NOT be deleted. They are kept for:

1. **Historical Reference**: To understand how requirements evolved
2. **Audit Trail**: To track design decisions over time
3. **Migration Verification**: To ensure no information was lost during consolidation
4. **Team Context**: For team members who worked on the original documents

---

## Questions?

If you need information from these files, check the corresponding IMPLEMENTATION.md file first. The new consolidated documents contain all the essential information from both the PRD and TDD, organized in a more logical flow.

For any questions about the documentation reorganization, see:
- `/design/README.md` - Main documentation entry point
- `/design/reference/GLOSSARY.md` - Unified terminology
- `/design/decisions/ADR-004-EVOLUTIONDocPattern.md` - Why we chose this pattern

---

**Reorganization Date**: 2025-11-04
**Branch**: feature/doc-tidy
