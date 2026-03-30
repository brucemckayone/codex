# @codex/admin

Admin analytics, content management, and customer management services. Used exclusively by admin-api worker.

## API

### `AnalyticsService`
| Method | Purpose |
|---|---|
| `getRevenueAnalytics(orgId, dateRange)` | Revenue, fees, payouts for date range |
| `getCustomerAnalytics(orgId, dateRange)` | User counts, LTV metrics |
| `getTopContent(orgId, dateRange, limit)` | Revenue-ranked content |

### `ContentManagementService`
| Method | Purpose |
|---|---|
| `listAllContent(orgId, filters)` | List all org content (admin view) |
| `publishOverride(contentId, orgId)` | Admin publish bypass |

### `CustomerManagementService`
| Method | Purpose |
|---|---|
| `listCustomers(orgId, filters)` | List purchasers |
| `grantAccess(userId, contentId, orgId)` | Complimentary access grant |

## Strict Rules

- **MUST** scope ALL queries by `organizationId` — admin sees one org at a time
- **MUST** require `platform_owner` role for all operations
- **NEVER** expose raw database queries or internal metrics in responses

## Integration

- **Depends on**: `@codex/database`, `@codex/service-errors`
- **Used by**: admin-api worker (port 42073)

## Reference Files

- `packages/admin/src/services/analytics-service.ts`
- `packages/admin/src/services/content-management-service.ts`
- `packages/admin/src/services/customer-management-service.ts`
