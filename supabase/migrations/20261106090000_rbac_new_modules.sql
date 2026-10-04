-- RBAC module registration — Phase 0 (P0.3) of
-- docs/modules/manasik-intelligence-build-roadmap.md; fixes F5 in
-- docs/modules/manasik-intelligence-implementation-plan.md §1.3 ("RBAC module
-- registry lags the product").
--
-- Widens role_permissions.module's check constraint to the 10 modules
-- lib/access/role-permissions-shared.ts's KNOWN_MODULES now lists:
-- `marketing` (its access file, lib/access/marketing-access.ts, already
-- existed for Campaigns but was never registered here — this migration
-- seeds it from that file's own CAPABILITIES map, not invented) plus 9
-- genuinely new placeholder modules (bookings, quotes, field_ops, guides,
-- support, relationships, agents, analytics, insights) whose real pages
-- land in later phases (docs/architecture/remaining-modules-master-plan.md §6). Every
-- placeholder module's seed mirrors lib/access/module-defaults.ts exactly:
-- ADMIN/CEO get every capability, every other role gets `viewModule` only
-- — a starting point, not a permanent design, superseded per-module once
-- that module's real Capabilities interface ships.
--
-- Safe to run after 20260924090000 (dynamic_roles_permissions).

alter table public.role_permissions drop constraint if exists role_permissions_module_check;
alter table public.role_permissions add constraint role_permissions_module_check
  check (module in (
    'departure_groups','documents','finance','leads','operations',
    'packages','pilgrims','reports','settings','suppliers','visa',
    'team','ai_agent','inbox',
    'marketing','bookings','quotes','field_ops','guides','support',
    'relationships','agents','analytics','insights'
  ));

insert into public.role_permissions (role_id, module, capabilities)
select r.id, v.module, v.capabilities::jsonb
from public.staff_roles r
join (values
  -- marketing — transcribed verbatim from lib/access/marketing-access.ts's
  -- live CAPABILITIES map, not a placeholder.
  ('ADMIN', 'marketing', '{"viewModule":true,"manageCampaigns":true,"manageCampaignStatus":true,"editSpend":true,"useAudienceForBroadcast":true,"manageContent":true,"viewAttribution":true,"actOnDiagnosis":true}'::jsonb),
  ('CEO', 'marketing', '{"viewModule":true,"manageCampaigns":false,"manageCampaignStatus":false,"editSpend":false,"useAudienceForBroadcast":false,"manageContent":false,"viewAttribution":true,"actOnDiagnosis":false}'::jsonb),
  ('FINANCE', 'marketing', '{"viewModule":true,"manageCampaigns":false,"manageCampaignStatus":false,"editSpend":false,"useAudienceForBroadcast":false,"manageContent":false,"viewAttribution":true,"actOnDiagnosis":false}'::jsonb),
  ('MARKETING', 'marketing', '{"viewModule":true,"manageCampaigns":true,"manageCampaignStatus":true,"editSpend":true,"useAudienceForBroadcast":true,"manageContent":true,"viewAttribution":true,"actOnDiagnosis":true}'::jsonb),
  ('OPERATIONS', 'marketing', '{"viewModule":true,"manageCampaigns":false,"manageCampaignStatus":false,"editSpend":false,"useAudienceForBroadcast":false,"manageContent":false,"viewAttribution":false,"actOnDiagnosis":false}'::jsonb),
  ('VISA', 'marketing', '{"viewModule":false,"manageCampaigns":false,"manageCampaignStatus":false,"editSpend":false,"useAudienceForBroadcast":false,"manageContent":false,"viewAttribution":false,"actOnDiagnosis":false}'::jsonb),
  ('GUIDE', 'marketing', '{"viewModule":false,"manageCampaigns":false,"manageCampaignStatus":false,"editSpend":false,"useAudienceForBroadcast":false,"manageContent":false,"viewAttribution":false,"actOnDiagnosis":false}'::jsonb),

  -- Placeholder modules — ADMIN/CEO all-true, every other role viewModule-only.
  -- Generated from lib/access/module-defaults.ts's own logic, not hand-typed.
  ('ADMIN', 'bookings', '{"viewModule":true,"createBooking":true,"editCommercials":true,"addTraveller":true,"changePackageOrGroup":true,"transferBooking":true,"cancelBooking":true,"approveDiscount":true,"viewFinancials":true,"viewSensitiveTravellerData":true,"assignOwners":true,"exportBookings":true,"assignedGroupOnly":true}'::jsonb),
  ('CEO', 'bookings', '{"viewModule":true,"createBooking":true,"editCommercials":true,"addTraveller":true,"changePackageOrGroup":true,"transferBooking":true,"cancelBooking":true,"approveDiscount":true,"viewFinancials":true,"viewSensitiveTravellerData":true,"assignOwners":true,"exportBookings":true,"assignedGroupOnly":true}'::jsonb),
  ('FINANCE', 'bookings', '{"viewModule":true,"createBooking":false,"editCommercials":false,"addTraveller":false,"changePackageOrGroup":false,"transferBooking":false,"cancelBooking":false,"approveDiscount":false,"viewFinancials":false,"viewSensitiveTravellerData":false,"assignOwners":false,"exportBookings":false,"assignedGroupOnly":false}'::jsonb),
  ('MARKETING', 'bookings', '{"viewModule":true,"createBooking":false,"editCommercials":false,"addTraveller":false,"changePackageOrGroup":false,"transferBooking":false,"cancelBooking":false,"approveDiscount":false,"viewFinancials":false,"viewSensitiveTravellerData":false,"assignOwners":false,"exportBookings":false,"assignedGroupOnly":false}'::jsonb),
  ('OPERATIONS', 'bookings', '{"viewModule":true,"createBooking":false,"editCommercials":false,"addTraveller":false,"changePackageOrGroup":false,"transferBooking":false,"cancelBooking":false,"approveDiscount":false,"viewFinancials":false,"viewSensitiveTravellerData":false,"assignOwners":false,"exportBookings":false,"assignedGroupOnly":false}'::jsonb),
  ('VISA', 'bookings', '{"viewModule":true,"createBooking":false,"editCommercials":false,"addTraveller":false,"changePackageOrGroup":false,"transferBooking":false,"cancelBooking":false,"approveDiscount":false,"viewFinancials":false,"viewSensitiveTravellerData":false,"assignOwners":false,"exportBookings":false,"assignedGroupOnly":false}'::jsonb),
  ('GUIDE', 'bookings', '{"viewModule":true,"createBooking":false,"editCommercials":false,"addTraveller":false,"changePackageOrGroup":false,"transferBooking":false,"cancelBooking":false,"approveDiscount":false,"viewFinancials":false,"viewSensitiveTravellerData":false,"assignOwners":false,"exportBookings":false,"assignedGroupOnly":false}'::jsonb),

  ('ADMIN', 'quotes', '{"viewModule":true,"createQuote":true,"editQuote":true,"sendQuote":true,"applyDiscount":true,"applyUnrestrictedDiscount":true,"approveDiscount":true,"acceptOnBehalf":true,"rejectQuote":true,"convertToBooking":true,"viewMargin":true}'::jsonb),
  ('CEO', 'quotes', '{"viewModule":true,"createQuote":true,"editQuote":true,"sendQuote":true,"applyDiscount":true,"applyUnrestrictedDiscount":true,"approveDiscount":true,"acceptOnBehalf":true,"rejectQuote":true,"convertToBooking":true,"viewMargin":true}'::jsonb),
  ('FINANCE', 'quotes', '{"viewModule":true,"createQuote":false,"editQuote":false,"sendQuote":false,"applyDiscount":false,"applyUnrestrictedDiscount":false,"approveDiscount":false,"acceptOnBehalf":false,"rejectQuote":false,"convertToBooking":false,"viewMargin":false}'::jsonb),
  ('MARKETING', 'quotes', '{"viewModule":true,"createQuote":false,"editQuote":false,"sendQuote":false,"applyDiscount":false,"applyUnrestrictedDiscount":false,"approveDiscount":false,"acceptOnBehalf":false,"rejectQuote":false,"convertToBooking":false,"viewMargin":false}'::jsonb),
  ('OPERATIONS', 'quotes', '{"viewModule":true,"createQuote":false,"editQuote":false,"sendQuote":false,"applyDiscount":false,"applyUnrestrictedDiscount":false,"approveDiscount":false,"acceptOnBehalf":false,"rejectQuote":false,"convertToBooking":false,"viewMargin":false}'::jsonb),
  ('VISA', 'quotes', '{"viewModule":true,"createQuote":false,"editQuote":false,"sendQuote":false,"applyDiscount":false,"applyUnrestrictedDiscount":false,"approveDiscount":false,"acceptOnBehalf":false,"rejectQuote":false,"convertToBooking":false,"viewMargin":false}'::jsonb),
  ('GUIDE', 'quotes', '{"viewModule":true,"createQuote":false,"editQuote":false,"sendQuote":false,"applyDiscount":false,"applyUnrestrictedDiscount":false,"approveDiscount":false,"acceptOnBehalf":false,"rejectQuote":false,"convertToBooking":false,"viewMargin":false}'::jsonb),

  ('ADMIN', 'field_ops', '{"viewModule":true,"manageFlights":true,"issueTickets":true,"manageHotelContracts":true,"manageRooming":true,"unlockRoomAssignments":true,"manageTransport":true,"manageItinerary":true,"publishItinerary":true,"exportManifest":true,"viewSupplierCosts":true,"assignedGroupOnly":true}'::jsonb),
  ('CEO', 'field_ops', '{"viewModule":true,"manageFlights":true,"issueTickets":true,"manageHotelContracts":true,"manageRooming":true,"unlockRoomAssignments":true,"manageTransport":true,"manageItinerary":true,"publishItinerary":true,"exportManifest":true,"viewSupplierCosts":true,"assignedGroupOnly":true}'::jsonb),
  ('FINANCE', 'field_ops', '{"viewModule":true,"manageFlights":false,"issueTickets":false,"manageHotelContracts":false,"manageRooming":false,"unlockRoomAssignments":false,"manageTransport":false,"manageItinerary":false,"publishItinerary":false,"exportManifest":false,"viewSupplierCosts":false,"assignedGroupOnly":false}'::jsonb),
  ('MARKETING', 'field_ops', '{"viewModule":true,"manageFlights":false,"issueTickets":false,"manageHotelContracts":false,"manageRooming":false,"unlockRoomAssignments":false,"manageTransport":false,"manageItinerary":false,"publishItinerary":false,"exportManifest":false,"viewSupplierCosts":false,"assignedGroupOnly":false}'::jsonb),
  ('OPERATIONS', 'field_ops', '{"viewModule":true,"manageFlights":false,"issueTickets":false,"manageHotelContracts":false,"manageRooming":false,"unlockRoomAssignments":false,"manageTransport":false,"manageItinerary":false,"publishItinerary":false,"exportManifest":false,"viewSupplierCosts":false,"assignedGroupOnly":false}'::jsonb),
  ('VISA', 'field_ops', '{"viewModule":true,"manageFlights":false,"issueTickets":false,"manageHotelContracts":false,"manageRooming":false,"unlockRoomAssignments":false,"manageTransport":false,"manageItinerary":false,"publishItinerary":false,"exportManifest":false,"viewSupplierCosts":false,"assignedGroupOnly":false}'::jsonb),
  ('GUIDE', 'field_ops', '{"viewModule":true,"manageFlights":false,"issueTickets":false,"manageHotelContracts":false,"manageRooming":false,"unlockRoomAssignments":false,"manageTransport":false,"manageItinerary":false,"publishItinerary":false,"exportManifest":false,"viewSupplierCosts":false,"assignedGroupOnly":false}'::jsonb),

  ('ADMIN', 'guides', '{"viewModule":true,"manageRoster":true,"assignGuides":true,"viewGuideWorkload":true,"viewAssignedManifest":true,"submitCheckin":true,"recordHandover":true,"viewPilgrimContacts":true,"viewMedicalFlags":true}'::jsonb),
  ('CEO', 'guides', '{"viewModule":true,"manageRoster":true,"assignGuides":true,"viewGuideWorkload":true,"viewAssignedManifest":true,"submitCheckin":true,"recordHandover":true,"viewPilgrimContacts":true,"viewMedicalFlags":true}'::jsonb),
  ('FINANCE', 'guides', '{"viewModule":true,"manageRoster":false,"assignGuides":false,"viewGuideWorkload":false,"viewAssignedManifest":false,"submitCheckin":false,"recordHandover":false,"viewPilgrimContacts":false,"viewMedicalFlags":false}'::jsonb),
  ('MARKETING', 'guides', '{"viewModule":true,"manageRoster":false,"assignGuides":false,"viewGuideWorkload":false,"viewAssignedManifest":false,"submitCheckin":false,"recordHandover":false,"viewPilgrimContacts":false,"viewMedicalFlags":false}'::jsonb),
  ('OPERATIONS', 'guides', '{"viewModule":true,"manageRoster":false,"assignGuides":false,"viewGuideWorkload":false,"viewAssignedManifest":false,"submitCheckin":false,"recordHandover":false,"viewPilgrimContacts":false,"viewMedicalFlags":false}'::jsonb),
  ('VISA', 'guides', '{"viewModule":true,"manageRoster":false,"assignGuides":false,"viewGuideWorkload":false,"viewAssignedManifest":false,"submitCheckin":false,"recordHandover":false,"viewPilgrimContacts":false,"viewMedicalFlags":false}'::jsonb),
  ('GUIDE', 'guides', '{"viewModule":true,"manageRoster":false,"assignGuides":false,"viewGuideWorkload":false,"viewAssignedManifest":false,"submitCheckin":false,"recordHandover":false,"viewPilgrimContacts":false,"viewMedicalFlags":false}'::jsonb),

  ('ADMIN', 'support', '{"viewModule":true,"createCase":true,"assignCase":true,"escalate":true,"resolveCase":true,"closeCase":true,"viewMedicalDetail":true,"viewComplaints":true,"runPostTripReview":true}'::jsonb),
  ('CEO', 'support', '{"viewModule":true,"createCase":true,"assignCase":true,"escalate":true,"resolveCase":true,"closeCase":true,"viewMedicalDetail":true,"viewComplaints":true,"runPostTripReview":true}'::jsonb),
  ('FINANCE', 'support', '{"viewModule":true,"createCase":false,"assignCase":false,"escalate":false,"resolveCase":false,"closeCase":false,"viewMedicalDetail":false,"viewComplaints":false,"runPostTripReview":false}'::jsonb),
  ('MARKETING', 'support', '{"viewModule":true,"createCase":false,"assignCase":false,"escalate":false,"resolveCase":false,"closeCase":false,"viewMedicalDetail":false,"viewComplaints":false,"runPostTripReview":false}'::jsonb),
  ('OPERATIONS', 'support', '{"viewModule":true,"createCase":false,"assignCase":false,"escalate":false,"resolveCase":false,"closeCase":false,"viewMedicalDetail":false,"viewComplaints":false,"runPostTripReview":false}'::jsonb),
  ('VISA', 'support', '{"viewModule":true,"createCase":false,"assignCase":false,"escalate":false,"resolveCase":false,"closeCase":false,"viewMedicalDetail":false,"viewComplaints":false,"runPostTripReview":false}'::jsonb),
  ('GUIDE', 'support', '{"viewModule":true,"createCase":false,"assignCase":false,"escalate":false,"resolveCase":false,"closeCase":false,"viewMedicalDetail":false,"viewComplaints":false,"runPostTripReview":false}'::jsonb),

  ('ADMIN', 'relationships', '{"viewModule":true,"configurePortal":true,"managePortalAccess":true,"draftAnnouncement":true,"approveAnnouncement":true,"sendAnnouncement":true,"manageSurveys":true,"viewResponses":true,"manageLoyalty":true,"awardCredit":true}'::jsonb),
  ('CEO', 'relationships', '{"viewModule":true,"configurePortal":true,"managePortalAccess":true,"draftAnnouncement":true,"approveAnnouncement":true,"sendAnnouncement":true,"manageSurveys":true,"viewResponses":true,"manageLoyalty":true,"awardCredit":true}'::jsonb),
  ('FINANCE', 'relationships', '{"viewModule":true,"configurePortal":false,"managePortalAccess":false,"draftAnnouncement":false,"approveAnnouncement":false,"sendAnnouncement":false,"manageSurveys":false,"viewResponses":false,"manageLoyalty":false,"awardCredit":false}'::jsonb),
  ('MARKETING', 'relationships', '{"viewModule":true,"configurePortal":false,"managePortalAccess":false,"draftAnnouncement":false,"approveAnnouncement":false,"sendAnnouncement":false,"manageSurveys":false,"viewResponses":false,"manageLoyalty":false,"awardCredit":false}'::jsonb),
  ('OPERATIONS', 'relationships', '{"viewModule":true,"configurePortal":false,"managePortalAccess":false,"draftAnnouncement":false,"approveAnnouncement":false,"sendAnnouncement":false,"manageSurveys":false,"viewResponses":false,"manageLoyalty":false,"awardCredit":false}'::jsonb),
  ('VISA', 'relationships', '{"viewModule":true,"configurePortal":false,"managePortalAccess":false,"draftAnnouncement":false,"approveAnnouncement":false,"sendAnnouncement":false,"manageSurveys":false,"viewResponses":false,"manageLoyalty":false,"awardCredit":false}'::jsonb),
  ('GUIDE', 'relationships', '{"viewModule":true,"configurePortal":false,"managePortalAccess":false,"draftAnnouncement":false,"approveAnnouncement":false,"sendAnnouncement":false,"manageSurveys":false,"viewResponses":false,"manageLoyalty":false,"awardCredit":false}'::jsonb),

  ('ADMIN', 'agents', '{"viewModule":true,"onboardAgent":true,"setCreditLimit":true,"allocatePackages":true,"approveAgentBooking":true,"viewAgentMargin":true,"settleCommissions":true}'::jsonb),
  ('CEO', 'agents', '{"viewModule":true,"onboardAgent":true,"setCreditLimit":true,"allocatePackages":true,"approveAgentBooking":true,"viewAgentMargin":true,"settleCommissions":true}'::jsonb),
  ('FINANCE', 'agents', '{"viewModule":true,"onboardAgent":false,"setCreditLimit":false,"allocatePackages":false,"approveAgentBooking":false,"viewAgentMargin":false,"settleCommissions":false}'::jsonb),
  ('MARKETING', 'agents', '{"viewModule":true,"onboardAgent":false,"setCreditLimit":false,"allocatePackages":false,"approveAgentBooking":false,"viewAgentMargin":false,"settleCommissions":false}'::jsonb),
  ('OPERATIONS', 'agents', '{"viewModule":true,"onboardAgent":false,"setCreditLimit":false,"allocatePackages":false,"approveAgentBooking":false,"viewAgentMargin":false,"settleCommissions":false}'::jsonb),
  ('VISA', 'agents', '{"viewModule":true,"onboardAgent":false,"setCreditLimit":false,"allocatePackages":false,"approveAgentBooking":false,"viewAgentMargin":false,"settleCommissions":false}'::jsonb),
  ('GUIDE', 'agents', '{"viewModule":true,"onboardAgent":false,"setCreditLimit":false,"allocatePackages":false,"approveAgentBooking":false,"viewAgentMargin":false,"settleCommissions":false}'::jsonb),

  ('ADMIN', 'analytics', '{"viewModule":true,"viewGrowth":true,"viewSales":true,"viewFinance":true,"viewMargin":true,"viewSupplier":true,"viewServiceQuality":true,"viewAllBranches":true,"exportAnalytics":true}'::jsonb),
  ('CEO', 'analytics', '{"viewModule":true,"viewGrowth":true,"viewSales":true,"viewFinance":true,"viewMargin":true,"viewSupplier":true,"viewServiceQuality":true,"viewAllBranches":true,"exportAnalytics":true}'::jsonb),
  ('FINANCE', 'analytics', '{"viewModule":true,"viewGrowth":false,"viewSales":false,"viewFinance":false,"viewMargin":false,"viewSupplier":false,"viewServiceQuality":false,"viewAllBranches":false,"exportAnalytics":false}'::jsonb),
  ('MARKETING', 'analytics', '{"viewModule":true,"viewGrowth":false,"viewSales":false,"viewFinance":false,"viewMargin":false,"viewSupplier":false,"viewServiceQuality":false,"viewAllBranches":false,"exportAnalytics":false}'::jsonb),
  ('OPERATIONS', 'analytics', '{"viewModule":true,"viewGrowth":false,"viewSales":false,"viewFinance":false,"viewMargin":false,"viewSupplier":false,"viewServiceQuality":false,"viewAllBranches":false,"exportAnalytics":false}'::jsonb),
  ('VISA', 'analytics', '{"viewModule":true,"viewGrowth":false,"viewSales":false,"viewFinance":false,"viewMargin":false,"viewSupplier":false,"viewServiceQuality":false,"viewAllBranches":false,"exportAnalytics":false}'::jsonb),
  ('GUIDE', 'analytics', '{"viewModule":true,"viewGrowth":false,"viewSales":false,"viewFinance":false,"viewMargin":false,"viewSupplier":false,"viewServiceQuality":false,"viewAllBranches":false,"exportAnalytics":false}'::jsonb),

  ('ADMIN', 'insights', '{"viewModule":true,"viewInsight":true,"dismissInsight":true,"actOnInsight":true,"manageAiSettings":true,"viewAiActionHistory":true,"viewShadowResults":true,"manageAiSurfaces":true,"reviewAiFeedback":true,"runGenerators":true}'::jsonb),
  ('CEO', 'insights', '{"viewModule":true,"viewInsight":true,"dismissInsight":true,"actOnInsight":true,"manageAiSettings":true,"viewAiActionHistory":true,"viewShadowResults":true,"manageAiSurfaces":true,"reviewAiFeedback":true,"runGenerators":true}'::jsonb),
  ('FINANCE', 'insights', '{"viewModule":true,"viewInsight":false,"dismissInsight":false,"actOnInsight":false,"manageAiSettings":false,"viewAiActionHistory":false,"viewShadowResults":false,"manageAiSurfaces":false,"reviewAiFeedback":false,"runGenerators":false}'::jsonb),
  ('MARKETING', 'insights', '{"viewModule":true,"viewInsight":false,"dismissInsight":false,"actOnInsight":false,"manageAiSettings":false,"viewAiActionHistory":false,"viewShadowResults":false,"manageAiSurfaces":false,"reviewAiFeedback":false,"runGenerators":false}'::jsonb),
  ('OPERATIONS', 'insights', '{"viewModule":true,"viewInsight":false,"dismissInsight":false,"actOnInsight":false,"manageAiSettings":false,"viewAiActionHistory":false,"viewShadowResults":false,"manageAiSurfaces":false,"reviewAiFeedback":false,"runGenerators":false}'::jsonb),
  ('VISA', 'insights', '{"viewModule":true,"viewInsight":false,"dismissInsight":false,"actOnInsight":false,"manageAiSettings":false,"viewAiActionHistory":false,"viewShadowResults":false,"manageAiSurfaces":false,"reviewAiFeedback":false,"runGenerators":false}'::jsonb),
  ('GUIDE', 'insights', '{"viewModule":true,"viewInsight":false,"dismissInsight":false,"actOnInsight":false,"manageAiSettings":false,"viewAiActionHistory":false,"viewShadowResults":false,"manageAiSurfaces":false,"reviewAiFeedback":false,"runGenerators":false}'::jsonb)
) as v(base_role, module, capabilities) on v.base_role = r.base_role
where r.is_system = true
on conflict (role_id, module) do nothing;

notify pgrst, 'reload schema';
