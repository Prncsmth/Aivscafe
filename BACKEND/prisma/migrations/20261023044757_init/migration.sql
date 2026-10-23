-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'CASHIER');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('G', 'KG', 'ML', 'L', 'PCS');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('WALK_IN', 'DELIVERY', 'MESSENGER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'GCASH');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'OFFLINE_SYNC');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'SALE_REVERSAL', 'ADJUSTMENT', 'WASTE');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_REVIEW', 'REVIEWED');

-- CreateEnum
CREATE TYPE "CashMovementType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateEnum
CREATE TYPE "ConflictType" AS ENUM ('PRICE_MISMATCH', 'CATALOG_OUTDATED', 'INSUFFICIENT_STOCK', 'PRODUCT_UNAVAILABLE', 'DISCOUNT_LIMIT', 'SHIFT_CLOSED');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('INGREDIENTS', 'PACKAGING', 'TRANSPORTATION', 'UTILITIES', 'RENT', 'SALARIES', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCentavos" INTEGER NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Modifier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCentavos" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Modifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModifier" (
    "productId" TEXT NOT NULL,
    "modifierId" TEXT NOT NULL,

    CONSTRAINT "ProductModifier_pkey" PRIMARY KEY ("productId","modifierId")
);

-- CreateTable
CREATE TABLE "RecipeItem" (
    "id" TEXT NOT NULL,
    "variantId" TEXT,
    "modifierId" TEXT,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "RecipeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUnit" "Unit" NOT NULL,
    "stockQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "avgUnitCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "lowStockThreshold" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "purchaseItemId" TEXT,
    "batchCode" TEXT,
    "receivedQty" DECIMAL(14,3) NOT NULL,
    "remainingQty" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "valueCentavos" INTEGER NOT NULL,
    "stockAfter" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "purchaseId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "reference" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalCentavos" INTEGER NOT NULL,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" "Unit" NOT NULL,
    "baseQuantity" DECIMAL(14,3) NOT NULL,
    "totalCostCentavos" INTEGER NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "batchCode" TEXT,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryArea" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "feeCentavos" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tempReference" TEXT,
    "type" "OrderType" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "source" "OrderSource" NOT NULL DEFAULT 'ONLINE',
    "customerName" TEXT,
    "notes" TEXT,
    "subtotalCentavos" INTEGER NOT NULL,
    "discountCentavos" INTEGER NOT NULL DEFAULT 0,
    "discountReason" TEXT,
    "deliveryFeeCentavos" INTEGER NOT NULL DEFAULT 0,
    "totalCentavos" INTEGER NOT NULL,
    "paidCentavos" INTEGER NOT NULL DEFAULT 0,
    "refundedCentavos" INTEGER NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "cashierId" TEXT NOT NULL,
    "shiftId" TEXT,
    "catalogVersion" INTEGER,
    "clientCreatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "inventoryDeductedAt" TIMESTAMP(3),
    "inventoryReversedAt" TIMESTAMP(3),
    "stockOverride" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "variantName" TEXT NOT NULL,
    "unitPriceCentavos" INTEGER NOT NULL,
    "modifiersCentavos" INTEGER NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "lineTotalCentavos" INTEGER NOT NULL,
    "notes" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemModifier" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "modifierId" TEXT,
    "name" TEXT NOT NULL,
    "priceCentavos" INTEGER NOT NULL,

    CONSTRAINT "OrderItemModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "userId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryDetails" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "contactNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "areaId" TEXT,
    "areaName" TEXT NOT NULL,
    "deliveryFeeCentavos" INTEGER NOT NULL,
    "instructions" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "method" "PaymentMethod" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "tenderedCentavos" INTEGER,
    "changeCentavos" INTEGER,
    "reference" TEXT,
    "verification" "VerificationStatus" NOT NULL DEFAULT 'VERIFIED',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "recordedOffline" BOOLEAN NOT NULL DEFAULT false,
    "shiftId" TEXT,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openKey" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "startingCashCentavos" INTEGER NOT NULL,
    "expectedCashCentavos" INTEGER,
    "countedCashCentavos" INTEGER,
    "cashVarianceCentavos" INTEGER,
    "expectedGcashCentavos" INTEGER,
    "reportedGcashCentavos" INTEGER,
    "notes" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "type" "CashMovementType" NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCentavos" INTEGER NOT NULL,
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "ConflictType" NOT NULL,
    "details" JSONB NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrderCounter" (
    "day" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderCounter_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_categoryId_name_key" ON "Product"("categoryId", "name");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_name_key" ON "ProductVariant"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Modifier_name_key" ON "Modifier"("name");

-- CreateIndex
CREATE INDEX "RecipeItem_ingredientId_idx" ON "RecipeItem"("ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_variantId_ingredientId_key" ON "RecipeItem"("variantId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeItem_modifierId_ingredientId_key" ON "RecipeItem"("modifierId", "ingredientId");

-- CreateIndex
CREATE UNIQUE INDEX "Ingredient_name_key" ON "Ingredient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_purchaseItemId_key" ON "InventoryBatch"("purchaseItemId");

-- CreateIndex
CREATE INDEX "InventoryBatch_ingredientId_expiryDate_idx" ON "InventoryBatch"("ingredientId", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryMovement_ingredientId_createdAt_idx" ON "InventoryMovement"("ingredientId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_type_createdAt_idx" ON "InventoryMovement"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_orderId_ingredientId_type_key" ON "InventoryMovement"("orderId", "ingredientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Purchase_purchasedAt_idx" ON "Purchase"("purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryArea_name_key" ON "DeliveryArea"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientId_key" ON "Order"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_type_createdAt_idx" ON "Order"("type", "createdAt");

-- CreateIndex
CREATE INDEX "Order_paymentStatus_idx" ON "Order"("paymentStatus");

-- CreateIndex
CREATE INDEX "Order_shiftId_idx" ON "Order"("shiftId");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_idx" ON "OrderStatusEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryDetails_orderId_key" ON "DeliveryDetails"("orderId");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_shiftId_idx" ON "Payment"("shiftId");

-- CreateIndex
CREATE INDEX "Payment_method_createdAt_idx" ON "Payment"("method", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_openKey_key" ON "CashShift"("openKey");

-- CreateIndex
CREATE INDEX "CashShift_userId_openedAt_idx" ON "CashShift"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "CashMovement_shiftId_idx" ON "CashMovement"("shiftId");

-- CreateIndex
CREATE INDEX "Expense_incurredAt_idx" ON "Expense"("incurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SyncConflict_status_idx" ON "SyncConflict"("status");

-- CreateIndex
CREATE INDEX "SyncConflict_orderId_idx" ON "SyncConflict"("orderId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifier" ADD CONSTRAINT "ProductModifier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModifier" ADD CONSTRAINT "ProductModifier_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipeItem" ADD CONSTRAINT "RecipeItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "PurchaseItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemModifier" ADD CONSTRAINT "OrderItemModifier_modifierId_fkey" FOREIGN KEY ("modifierId") REFERENCES "Modifier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryDetails" ADD CONSTRAINT "DeliveryDetails_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryDetails" ADD CONSTRAINT "DeliveryDetails_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "DeliveryArea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashMovement" ADD CONSTRAINT "CashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncConflict" ADD CONSTRAINT "SyncConflict_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
