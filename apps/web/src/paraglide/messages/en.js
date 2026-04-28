/* eslint-disable */
/** 
 * This file contains language specific message functions for tree-shaking. 
 * 
 *! WARNING: Only import messages from this file if you want to manually
 *! optimize your bundle. Else, import from the `messages.js` file. 
 * 
 * Your bundler will (in the future) automatically replace the index function 
 * with a language specific message function in the build step. 
 */


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_signin_title = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_signin_button = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_signup_title = () => `Create Account`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_signup_button = () => `Create Account`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_email_label = () => `Email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_password_label = () => `Password`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_confirm_password_label = () => `Confirm Password`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_name_label = () => `Name (optional)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_forgot_password = () => `Forgot your password?`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_reset_password_title = () => `Reset Password`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_reset_password_button = () => `Reset Password`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_no_account = () => `Don't have an account?`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_signup_link = () => `Sign up`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_have_account = () => `Already have an account?`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_signin_link = () => `Sign in`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_check_email = () => `Check your email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_reset_email_sent = () => `If an account exists with that email, we've sent password reset instructions.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_verify_email_success = () => `Email verified successfully!`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_verify_email_error = () => `Invalid or expired verification link.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_loading = () => `Loading...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_or = () => `or`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_pagination = () => `Pagination`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_previous = () => `Previous`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_next = () => `Next`


/**
 * @param {{ current: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_page_x_of_y = (params) => `Page ${params.current} of ${params.total}`


/**
 * @param {{ page: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_page_number = (params) => `Page ${params.page}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_go_to_account = () => `Go to Account`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_go_back = () => `Go Back`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_sign_in = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_try_again = () => `Try Again`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const common_cancel = () => `Cancel`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_validation_email_invalid = () => `Please enter a valid email address`


/**
 * @param {{ min: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_validation_password_min = (params) => `Password must be at least ${params.min} characters`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_validation_password_letter = () => `Password must contain at least one letter`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_validation_password_number = () => `Password must contain at least one number`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_validation_password_required = () => `Password is required`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const auth_validation_passwords_mismatch = () => `Passwords do not match`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_profile_title = () => `Profile`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_profile_description = () => `Manage your account profile and preferences.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_personal_information = () => `Personal Information`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_display_name = () => `Display Name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_display_name_placeholder = () => `Your display name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_email = () => `Email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_email_placeholder = () => `your@email.com`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_email_change_disclaimer = () => `Email cannot be changed here. Contact support for assistance.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_username = () => `Username`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_username_placeholder = () => `username`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_bio = () => `Bio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_bio_placeholder = () => `Tell us about yourself`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_social_links = () => `Social Links`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_social_website = () => `Website`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_social_twitter = () => `Twitter`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_social_youtube = () => `YouTube`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_social_instagram = () => `Instagram`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_save_button = () => `Save Changes`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_save_success = () => `Profile updated successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_save_error = () => `Failed to update profile`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_saving = () => `Saving...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_avatar_heading = () => `Avatar`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_avatar_upload = () => `Upload New`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_avatar_save = () => `Save Avatar`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_avatar_uploading = () => `Uploading...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_avatar_remove = () => `Remove`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_avatar_help = () => `JPG, GIF or PNG. Max size 5MB.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_save_button = () => `Save Preferences`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_title = () => `Notifications`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_description = () => `Manage how and when you receive notifications.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_email_section = () => `Email Notifications`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_follow_creators = () => `New content from followed creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_follow_creators_desc = () => `Get notified when creators you follow publish new content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_receipts = () => `Purchase receipts`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_receipts_desc = () => `Receive email receipts for purchases.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_updates = () => `Product updates`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_updates_desc = () => `Learn about new features and improvements.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_marketing = () => `Marketing emails`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_marketing_desc = () => `Receive news and special offers.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_transactional = () => `Transactional emails`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_transactional_desc = () => `Essential emails about your account.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_digest = () => `Weekly digest`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_digest_desc = () => `Get a weekly summary of activity.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_save_success = () => `Preferences updated successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_notifications_save_error = () => `Failed to update preferences`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_title = () => `Payments`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_description = () => `Manage your billing information and purchase history.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_billing = () => `Billing Information`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_billing_description = () => `Manage all your Codex subscriptions, payment methods and invoices in one place via the Stripe Customer Portal.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_manage_billing = () => `Manage Billing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_none_placeholder = () => `No payment methods on file. Payment methods will be added when you make your first purchase.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_history = () => `Purchase History`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_none_history = () => `No purchases yet. Browse the Discover page to find content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_empty_description = () => `Your purchase history will appear here.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_discover_link = () => `Browse Discover`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_column_date = () => `Date`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_column_content = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_column_amount = () => `Amount`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_column_status = () => `Status`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_status_complete = () => `Complete`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_status_pending = () => `Pending`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_status_failed = () => `Failed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_status_refunded = () => `Refunded`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_status_unknown = () => `Unknown`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_filter_all = () => `All`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_filter_complete = () => `Complete`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_filter_pending = () => `Pending`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_filter_failed = () => `Failed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_payments_filter_refunded = () => `Refunded`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_settings_title = () => `Account Settings`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_not_found = () => `Account not found`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_not_found_description = () => `The account page you're looking for doesn't exist or has been moved.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_unauthorized = () => `You must be signed in to access this page`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_unauthorized_description = () => `Please sign in to access your account settings.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_forbidden = () => `You don't have permission to access this page`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_forbidden_description = () => `You don't have permission to view this account page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_server_error = () => `Something went wrong. Please try again later.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const account_error_server_error_description = () => `An unexpected error occurred. Please try again later.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_toggle_menu = () => `Toggle menu`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_close_menu = () => `Close menu`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_view_public_site = () => `View Public Site`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_sidebar_collapse = () => `Collapse`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_sidebar_expand = () => `Expand sidebar`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_search_placeholder = () => `Search content...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_search_clear = () => `Clear search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_search_empty = () => `No matching content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_search_empty_description = () => `Try a different search term or clear the filter.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_search_clear_filter = () => `Clear search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_error_title = () => `Studio Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_error_description = () => `Something went wrong in the Studio. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_error_back_to_org = () => `Back to Organization`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_switcher_personal = () => `Personal`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_switcher_organization = () => `Organization`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_switcher_personal_studio = () => `Personal Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_switcher_add_organisation = () => `Add Organisation`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_switcher_switch_studio = () => `Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_open_menu = () => `Open studio menu`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_title = () => `Create Organisation`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_description = () => `Set up a new organisation to collaborate with your team and publish content together.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_name_label = () => `Organisation name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_name_placeholder = () => `e.g. Acme Studios`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_slug_label = () => `URL handle`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_slug_checking = () => `Checking availability…`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_slug_available = () => `This handle is available`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_slug_taken = () => `This handle is already taken`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_submit = () => `Create Organisation`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_success = () => `Organisation created successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_create_error = () => `Failed to create organisation`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_access_denied = () => `Insufficient permissions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_access_denied_description = () => `You don't have permission to access the Studio.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_navigation_home = () => `Home`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_navigation_explore = () => `Explore`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_navigation_creators = () => `Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_navigation_library = () => `Library`


/**
 * @param {{ orgName: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_landing_title = (params) => `Welcome to ${params.orgName}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_landing_subtitle = () => `Discover amazing content from our creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_landing_explore_cta = () => `Explore Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_landing_featured_title = () => `Featured Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_landing_featured_empty = () => `No featured content available yet`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_explore = () => `Start Exploring`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_browse = () => `Browse Content`


/**
 * @param {{ title: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_continue = (params) => `Continue: ${params.title}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_go_to_studio = () => `Go to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_my_library = () => `My Library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_meet_creators = () => `Meet Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_watch_intro = () => `Watch Intro`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_watch_now = () => `Watch Now`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_latest_release = () => `Latest Release`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_free = () => `Free`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_video_count = (params) => `${params.count} Videos`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_audio_count = (params) => `${params.count} Audio`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_written_count = (params) => `${params.count} Written`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_items_count = (params) => `${params.count} items`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_creators_count = (params) => `${params.count} creators`


/**
 * @param {{ hours: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_hero_hours = (params) => `${params.hours} hrs of content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_featured_content = () => `Featured Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_no_content_yet = () => `No content available yet`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_view_all_content = () => `View all content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_follow = () => `Follow`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_following = () => `Following`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_unfollow = () => `Unfollow`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_followers_count = (params) => `${params.count} followers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const followers_only_cta_title = () => `Follow to unlock`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const followers_only_cta_description = () => `This piece is free for followers. Follow to read the full article and get more like it in your feed.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_only_cta_title = () => `Team Only`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_only_cta_description = () => `This content is only available to team members`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_continue_watching_title = () => `Continue Watching`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_continue_watching_view_library = () => `View Library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_new_releases_title = () => `New Releases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_preview_title = () => `Our Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_preview_view_all = () => `Meet All Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_title = () => `Explore`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_subtitle = () => `Browse all content from our creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_search_placeholder = () => `Search content...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_filter_all = () => `All`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_filter_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_filter_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_filter_written = () => `Written`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_sort_newest = () => `Newest`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_sort_popular = () => `Popular`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_sort_az = () => `A-Z`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_empty = () => `No content found`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_explore_no_results = () => `No results match your search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_title = () => `Explore Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_search_placeholder = () => `Search content...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_filter_all = () => `All Types`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_filter_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_filter_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_filter_article = () => `Article`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_sort_newest = () => `Newest`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_sort_oldest = () => `Oldest`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_sort_title = () => `A-Z`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_sort_popular = () => `Most Popular`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_sort_top_selling = () => `Top Selling`


/**
 * @param {{ count: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_showing_filtered = (params) => `Showing ${params.count} of ${params.total} results`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_no_content = () => `No content available yet`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_no_content_description = () => `This organization hasn't published any content yet. Check back soon.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_no_results = () => `No content matches your search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_clear_filters = () => `Clear filters`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const explore_results_count = (params) => `${params.count} results`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_title = () => `Our Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_subtitle = () => `Meet the talented people behind the content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_empty = () => `No creators yet`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_empty_description = () => `No creators have joined this organization yet. Check back soon.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_latest_release = () => `Latest release`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_library_empty = () => `No purchases yet`


/**
 * @param {{ orgName: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_library_empty_description = (params) => `Content you purchase from ${params.orgName} will appear here.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_library_browse = () => `Browse Content`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_creators_content_count = (params) => `${params.count} content items`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_not_found = () => `Page not found`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_not_found_description = () => `The page you're looking for doesn't exist.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_unauthorized = () => `You must be signed in to access this page`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_unauthorized_description = () => `Please sign in to access this page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_forbidden = () => `You don't have permission to access this page`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_forbidden_description = () => `You don't have permission to view this page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_server_error = () => `Something went wrong. Please try again later.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_server_error_description = () => `An unexpected error occurred. Please try again later.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_unknown = () => `An unknown error occurred`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_unknown_description = () => `Something went wrong. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_go_home = () => `Go Home`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_go_back = () => `Go Back`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const org_error_sign_in = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const footer_about = () => `About`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const footer_terms = () => `Terms`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const footer_privacy = () => `Privacy`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const footer_copyright = () => `© 2026 Codex. All rights reserved.`


/**
 * @param {{ platform: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const footer_powered_by = (params) => `Powered by ${params.platform}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const footer_powered_by_platform = () => `Revelations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_not_found = () => `Page not found`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_not_found_description = () => `The page you're looking for doesn't exist or has been moved.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_forbidden = () => `Access denied`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_forbidden_description = () => `You don't have permission to view this page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_server_error = () => `Something went wrong`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_server_error_description = () => `We're working on fixing this. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_generic = () => `Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_generic_description = () => `An unexpected error occurred.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_go_home = () => `Go Home`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_go_back = () => `Go Back`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_sign_in = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_try_again = () => `Try Again`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_type_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_type_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_type_article = () => `Article`


/**
 * @param {{ title: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_view = (params) => `View ${params.title}`


/**
 * @param {{ title: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_thumbnail_alt = (params) => `Thumbnail for ${params.title}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_duration = () => `Duration`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_progress_completed = () => `Completed`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_progress_percent = (params) => `${params.percent}% watched`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_free = () => `Free`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_purchased = () => `Purchased`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_included = () => `Included`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_purchase_cta = () => `Purchase to watch`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_purchase_cta_description = () => `Get access to this content to start watching`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_signin_watch_cta = () => `Sign in to watch`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_signin_watch_description = () => `It's free — sign in to start watching`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_signin_listen_cta = () => `Sign in to listen`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_signin_listen_description = () => `It's free — sign in to start listening`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_signin_free_cta = () => `Sign in to watch`


/**
 * @param {{ creator: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_by_creator = (params) => `By ${params.creator}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_about = () => `About this content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefits_heading = () => `What you'll get`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefit_hd_video = () => `HD video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefit_hq_audio = () => `High-quality audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefit_full_article = () => `Full article`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefit_lifetime_access = () => `Lifetime access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefit_progress_tracking = () => `Progress tracking`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_benefit_any_device = () => `Watch on any device`


/**
 * @param {{ creator: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_detail_more_from_creator = (params) => `More from ${params.creator}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_dashboard_title = () => `Dashboard`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_dashboard_subtitle = () => `Overview of your organization's performance`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_creator_dashboard_subtitle = () => `Overview of your personal content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_stat_revenue = () => `Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_stat_customers = () => `Customers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_stat_content = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_stat_media = () => `Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_stat_views = () => `Views`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_activity_title = () => `Recent Activity`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_activity_empty = () => `No recent activity`


/**
 * @param {{ title: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_activity_purchase = (params) => `${params.title} was purchased`


/**
 * @param {{ title: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_activity_publish = (params) => `${params.title} was published`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_activity_signup = () => `New member joined`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_quick_actions = () => `Quick Actions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_action_create_content = () => `Create Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_action_upload_media = () => `Upload Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_action_analytics = () => `View Analytics`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_action_manage_team = () => `Manage Team`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_action_edit_branding = () => `Edit Branding`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_action_view_site = () => `View Public Site`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_revenue_chart_title = () => `Revenue (Last 14 Days)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_view_analytics = () => `View all analytics`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_preview_label = () => `Preview`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_preview_ended = () => `Preview ended`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_preview_cta = () => `Get full access to continue watching`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const purchase_sign_in = () => `Sign in to watch`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const purchase_cta_title = () => `Purchase to Watch`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const purchase_cta_description = () => `Get full access to this content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscribe_cta_title = () => `Subscribe to Watch`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscribe_cta_description = () => `Subscribe to get access to this content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const upgrade_cta_title = () => `Upgrade to Watch`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const upgrade_cta_description = () => `Upgrade your plan to access this content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const members_only_cta_title = () => `Members Only`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const members_only_cta_description = () => `This content is only available to team members`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_subscribers = () => `Subscription`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_followers = () => `Followers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_team = () => `Team`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_price_members = () => `Members`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_title = () => `Settings`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_general = () => `General`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_branding = () => `Branding`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_coming_soon = () => `General settings coming soon.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_error_title = () => `Settings Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_error_description = () => `Something went wrong loading settings. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_error_back_to_studio = () => `Back to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_title = () => `Billing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_manage_stripe = () => `Manage Billing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_manage_stripe_description = () => `Manage your subscriptions, payment methods and invoices via the Stripe portal. One portal covers every organisation you subscribe to.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_total_revenue = () => `Total Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_total_purchases = () => `Total Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_avg_order = () => `Avg Order Value`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_top_content = () => `Top Content by Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_top_content_empty = () => `No revenue data available yet.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_top_content_empty_description = () => `Revenue data will appear here once you make your first sale.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_top_content_column_title = () => `Title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_top_content_column_revenue = () => `Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_top_content_column_purchases = () => `Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_error_title = () => `Billing Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_error_description = () => `Something went wrong loading billing data. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const billing_error_back_to_studio = () => `Back to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_title = () => `Monetisation`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_description = () => `Manage subscription tiers and Stripe Connect.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_title = () => `Stripe Connect`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_description = () => `Connect your Stripe account to receive subscription payouts.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_not_connected = () => `Not connected`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_onboarding = () => `Completing setup…`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_active = () => `Connected`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_restricted = () => `Restricted — action needed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_start = () => `Connect Stripe Account`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_continue = () => `Continue Setup`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_dashboard = () => `Open Stripe Dashboard`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_charges_enabled = () => `Charges enabled`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_connect_payouts_enabled = () => `Payouts enabled`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_title = () => `Subscription Tiers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_description = () => `Define the tiers your audience can subscribe to.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_empty = () => `No subscription tiers yet.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_empty_description = () => `Create your first tier to start offering subscriptions.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_create = () => `Create Tier`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_edit = () => `Edit Tier`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_delete = () => `Delete Tier`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tiers_delete_confirm = () => `Are you sure you want to delete this tier? This cannot be undone.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_feature_requires_connect = () => `Connect a Stripe account to enable subscriptions.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tier_name = () => `Tier Name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tier_description = () => `Description`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tier_price_monthly = () => `Monthly Price (pence)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tier_price_annual = () => `Annual Price (pence)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tier_monthly = () => `monthly`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_tier_annual = () => `annual`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_stats_title = () => `Subscriber Stats`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_stats_total = () => `Total Subscribers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_stats_active = () => `Active`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_stats_mrr = () => `Monthly Recurring Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_feature_toggle = () => `Enable Subscriptions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_feature_toggle_description = () => `Allow customers to subscribe to your organisation.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_save = () => `Save`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const monetisation_cancel = () => `Cancel`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_pricing_title = () => `Pricing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_pricing_subtitle = () => `Choose a plan that works for you`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_monthly = () => `Monthly`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_annual = () => `Annual`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_per_month = () => `/mo`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_per_year = () => `/yr`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_save_percent = (params) => `Save ${params.percent}%`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_subscribe = () => `Subscribe`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_current_plan = () => `Current Plan`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_no_tiers = () => `No subscription plans available yet.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_features_included = () => `What's included`


/**
 * @param {{ tierName: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_all_tier_content = (params) => `Access to all ${params.tierName} content`


/**
 * @param {{ date: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_ends_on = (params) => `Plan ends ${params.date}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_payment_failed = () => `Payment failed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_paused = () => `Plan paused`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_reactivate_plan = () => `Reactivate plan`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_update_payment = () => `Update payment`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_resume_plan = () => `Resume plan`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_manage_plan = () => `Manage plan`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_badge = () => `Subscriber`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_manage = () => `Manage Subscriptions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_cancel = () => `Cancel Subscription`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_cancel_reason = () => `Reason for cancelling (optional)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_cancel_confirm = () => `Cancel at end of period`


/**
 * @param {{ orgName: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_cancel_follow_notice = (params) => `Cancelling won't unfollow you. If you follow ${params.orgName}, you'll keep receiving their updates — unfollow from their page if you'd rather not.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_label = () => `What made you cancel? (optional)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_too_expensive = () => `Too expensive`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_not_enough_content = () => `Not enough content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_found_alternative = () => `Found an alternative`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_not_using_it = () => `Not using it`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_technical_issues = () => `Technical issues`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_other = () => `Other`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_churn_reason_other_required = () => `Tell us more so we can improve.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_past_due_single = () => `A subscription needs attention — update your payment method to restore access.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_paused_single = () => `A subscription is paused. Resume to restore access.`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_multiple = (params) => `${params.count} subscriptions need attention.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_cta_manage = () => `Manage subscriptions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_cta_update_payment = () => `Update payment`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_cta_resume = () => `Resume`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_health_banner_dismiss = () => `Dismiss notice`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_reactivate = () => `Reactivate`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_change_tier = () => `Change Plan`


/**
 * @param {{ date: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_current_period_ends = (params) => `Current period ends ${params.date}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_status_active = () => `Active`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_status_cancelling = () => `Cancelling`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_status_past_due = () => `Past Due`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_status_cancelled = () => `Cancelled`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_no_subscriptions = () => `No active subscriptions.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_no_subscriptions_description = () => `Browse organisations to find content worth subscribing to.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_reactivate_confirm = () => `Reactivate Subscription`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_reactivate_description = () => `Your subscription will continue and you will be billed at the next renewal.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_update_payment = () => `Update Payment`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_past_due_message = () => `Your payment method needs to be updated to continue your subscription.`


/**
 * @param {{ date: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_cancelling_message = (params) => `This subscription will end on ${params.date}. You can reactivate to keep your access.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_disabled_title = () => `Subscriptions Not Available`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_disabled_description = () => `This organisation does not currently offer subscription plans.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_checkout_error = () => `Something went wrong starting your subscription. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_load_error = () => `Couldn't load your subscriptions. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_reactivate_error = () => `Couldn't reactivate this subscription. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_resume_error = () => `Couldn't resume this subscription. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_paused_message = () => `Your subscription is paused. Resume to restore access.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_resume = () => `Resume`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_success_title = () => `Subscription activated!`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const subscription_success_description = () => `Welcome! Your subscription is now active and you have access to all included content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_search_placeholder = () => `Search your library...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_all_types = () => `All`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_article = () => `Article`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_all_progress = () => `All`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_not_started = () => `Not Started`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_in_progress = () => `In Progress`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_completed = () => `Completed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_all_access = () => `All`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_purchased = () => `Purchased`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_subscription = () => `Subscription`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_filter_membership = () => `Member Access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_access_badge_purchased = () => `Purchased`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_access_badge_subscription = () => `Subscribed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_access_badge_membership = () => `Member`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_clear_filters = () => `Clear filters`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_no_results = () => `No results match your filters`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_continue_watching = () => `Continue Watching`


/**
 * @param {{ time: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_resume_from = (params) => `Resume from ${params.time}`


/**
 * @param {{ time: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_resume_listen_from = (params) => `Listen from ${params.time}`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_resume_read_from = (params) => `Read from ${params.percent}%`


/**
 * @param {{ time: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_time_remaining = (params) => `${params.time} left`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_resume = () => `Resume`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_resume_listening = () => `Continue listening`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_resume_reading = () => `Continue reading`


/**
 * @param {{ date: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_access_ends_on = (params) => `Ends ${params.date}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_access_subscription_ended = () => `Subscription ended — reactivate`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_access_payment_failed = () => `Payment failed — update payment`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_title = () => `Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_subtitle = () => `Manage your media files and uploads`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_title = () => `Upload Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_drop = () => `Drag and drop files here, or`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_browse = () => `browse files`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_hint = () => `Video or audio files. Max 5GB per file.`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_queued = (params) => `${params.count} file(s) queued`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_error = () => `Upload failed. Please try again.`


/**
 * @param {{ name: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_upload_rejected_type = (params) => `${params.name} is not a supported file type.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_status_uploading = () => `Uploading`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_status_uploaded = () => `Uploaded`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_status_processing = () => `Processing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_status_ready = () => `Ready`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_status_failed = () => `Failed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_empty = () => `No media files yet`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_empty_description = () => `Upload your first media file to get started.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_delete_confirm = () => `Are you sure you want to delete this media? This action cannot be undone.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_delete_title = () => `Delete Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_delete_button = () => `Delete`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_edit_title = () => `Edit Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_type_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_type_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_downloading = () => `Downloading source`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_probing = () => `Analysing media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_mezzanine = () => `Creating archive copy`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_loudness = () => `Measuring loudness`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_encoding_variants = () => `Encoding quality variants`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_preview = () => `Generating preview`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_thumbnails = () => `Extracting thumbnails`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_waveform = () => `Generating waveform`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_uploading_outputs = () => `Uploading outputs`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const transcoding_step_finalizing = () => `Finalising`


/**
 * @param {{ date: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_created = (params) => `Created ${params.date}`


/**
 * @param {{ size: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_size = (params) => `${params.size}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_error_title = () => `Media Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_error_description = () => `Something went wrong loading media. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_error_back_to_studio = () => `Back to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_title = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_create = () => `Create Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_empty = () => `No content yet. Create your first piece of content to get started.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_empty_description = () => `Create your first piece of content to get started.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_col_title = () => `Title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_col_type = () => `Type`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_col_status = () => `Status`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_col_created = () => `Created`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_col_actions = () => `Actions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_edit = () => `Edit`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_status_published = () => `Published`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_status_draft = () => `Draft`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_status_archived = () => `Archived`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_error_title = () => `Content Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_error_description = () => `Something went wrong loading content. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_error_back_to_studio = () => `Back to Studio`


/**
 * @param {{ name: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_view_profile = (params) => `View ${params.name}'s profile`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_count = (params) => `${params.count} content items`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_latest = () => `Latest Release`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_view_profile = () => `View Full Profile`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_no_content = () => `No content published yet`


/**
 * @param {{ date: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_joined = (params) => `Joined ${params.date}`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_content_items = (params) => `${params.count} content items`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_role_owner = () => `Owner`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_role_admin = () => `Admin`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_drawer_role_creator = () => `Creator`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_visit_website = () => `Visit website`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_visit_twitter = () => `Visit Twitter`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_visit_youtube = () => `Visit YouTube`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_visit_instagram = () => `Visit Instagram`


/**
 * @param {{ name: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_title = (params) => `${params.name} | Revelations Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_bio_default = () => `Independent creator sharing transformative content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_latest_content = () => `Latest Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_organizations = () => `Organizations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_organizations_subtitle = () => `Creates content for these organizations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_no_content = () => `No content published yet`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_no_content_description = () => `This creator hasn't published any content yet.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_follow = () => `Follow`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_stat_content = (params) => `${params.count} Content Items`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_stat_orgs = (params) => `${params.count} Organizations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_role_creator = () => `Creator`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_org_content_count = (params) => `${params.count} content items`


/**
 * @param {{ name: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_profile_view_on_org = (params) => `View on ${params.name}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_resource_not_found = () => `The resource you're looking for doesn't exist or has been moved.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_unauthorized = () => `Unauthorized`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_login_required = () => `You must be signed in to access this resource.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_login = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_browse_discover = () => `Browse Discover`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const errors_try_again_later = () => `Something went wrong. Please try again later.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_title = () => `Branding`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_description = () => `Customize your organization's visual identity.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_logo_title = () => `Logo`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_logo_description = () => `Upload your organization logo. Displayed in navigation and public pages.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_logo_upload = () => `Upload Logo`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_logo_delete = () => `Remove Logo`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_logo_delete_confirm = () => `Are you sure you want to remove the logo?`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_color_title = () => `Brand Colors`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_color_description = () => `Choose colors for buttons, links, and accents across your platform.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_color_primary = () => `Primary Color`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_color_secondary = () => `Secondary Color`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_color_accent = () => `Accent Color`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_color_clear = () => `Clear`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_typography_title = () => `Typography`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_typography_description = () => `Choose fonts for your platform. Leave as default to use the system font.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_typography_body = () => `Body Font`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_typography_heading = () => `Heading Font`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_typography_default = () => `Platform Default (Inter)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_title = () => `Shape & Spacing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_description = () => `Control the border radius and spacing density across your platform.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_radius = () => `Border Radius`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_radius_sharp = () => `Sharp`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_radius_rounded = () => `Round`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_density = () => `Spacing Density`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_density_compact = () => `Compact`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_shape_density_spacious = () => `Spacious`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_save = () => `Save Changes`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_saved = () => `Branding updated successfully.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const branding_error = () => `Failed to update branding.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_create_title = () => `Create Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_edit_title = () => `Edit Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_title_label = () => `Title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_title_placeholder = () => `Enter content title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_slug_label = () => `Slug`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_slug_placeholder = () => `content-url-slug`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_slug_checking = () => `Checking availability…`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_slug_available = () => `Slug is available`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_slug_taken = () => `This slug is already taken`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_description_label = () => `Description`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_description_placeholder = () => `Describe your content...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_content_type_label = () => `Content Type`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_label = () => `Visibility`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_price_label = () => `Price`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_price_placeholder = () => `0.00`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_price_help = () => `Leave at £0.00 for free content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_submit_create = () => `Create Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_submit_update = () => `Save Changes`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_submitting = () => `Saving...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_delete = () => `Delete Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_delete_confirm_title = () => `Delete Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_delete_confirm_description = () => `Are you sure you want to delete this content? This action cannot be undone.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_create_success = () => `Content created successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_update_success = () => `Content updated successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_delete_success = () => `Content deleted successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_create_error = () => `Failed to create content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_update_error = () => `Failed to update content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_delete_error = () => `Failed to delete content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_publish = () => `Publish`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_unpublish = () => `Unpublish`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_publishing = () => `Publishing...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_unpublishing = () => `Unpublishing...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_publish_success = () => `Content published successfully`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_unpublish_success = () => `Content unpublished to draft`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_publish_error = () => `Failed to publish content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_unpublish_error = () => `Failed to unpublish content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_status_label = () => `Status`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_public = () => `Public`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_private = () => `Private`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_members_only = () => `Members Only`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_purchased_only = () => `Purchased Only`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_type_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_type_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_type_article = () => `Article`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_back_to_content = () => `Back to Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_body_label = () => `Content Body`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_body_placeholder = () => `Start writing...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_media_required = () => `A media item is required for video and audio content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_body_required = () => `Content body is required for articles`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_section_details = () => `Details`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_section_media = () => `Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_section_media_desc = () => `Select the media file for this content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_media_hint = () => `No ready media available. Upload files in the Media library first.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_placeholder = () => `Select media...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_search = () => `Search media...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_no_media = () => `No media attached`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_clear = () => `Remove media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_empty_title = () => `No media available`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_empty_desc = () => `Upload files in the Media library to attach them to content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_go_to_library = () => `Go to Media library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_picker_no_results = () => `No media matches your search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_edit_title_label = () => `Title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_edit_description_label = () => `Description`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_edit_description_placeholder = () => `Add a description...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_edit_save = () => `Save Changes`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_filter_all_types = () => `All Types`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const media_filter_all_status = () => `All Status`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_section_body = () => `Body`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_section_body_desc = () => `Write or paste your content body.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_section_publishing = () => `Publishing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_public_desc = () => `Anyone can view this content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_private_desc = () => `Only you can see this content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_members_only_desc = () => `Only organisation members can access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_visibility_purchased_only_desc = () => `Viewers must purchase access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_label = () => `Access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_free = () => `Free`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_free_desc = () => `Anyone can access this content for free`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_paid = () => `One-time purchase`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_paid_desc = () => `Viewers pay a one-time price to access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_subscribers = () => `Subscribers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_subscribers_desc = () => `Available to subscribers at or above a tier`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_followers = () => `Followers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_followers_desc = () => `Must follow your organisation (free)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_team = () => `Team only`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_team_desc = () => `Only team members (owners, admins, creators)`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_members = () => `Members only`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_members_desc = () => `Only your organisation team members can access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_access_also_purchasable = () => `Also available for one-time purchase`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_content_form_slug_preview = () => `URL preview`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const seo_default_site_name = () => `Revelations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const seo_default_description = () => `Discover transformative content from independent creators`


/**
 * @param {{ username: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_title = (params) => `${params.username}'s Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_search_placeholder = () => `Search content...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_filter_all = () => `All`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_filter_video = () => `Video`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_filter_audio = () => `Audio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_filter_article = () => `Article`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_empty = () => `No content available`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_empty_description = () => `This creator hasn't published any content yet.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_no_results = () => `No content matches your search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_error_title = () => `Content Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const creator_content_error_description = () => `Something went wrong loading content. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_sort_label = () => `Sort by`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_sort_recent_purchase = () => `Recently Purchased`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_sort_recent_watched = () => `Recently Watched`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_sort_az = () => `A-Z`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_sort_za = () => `Z-A`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_title = () => `Customers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_empty = () => `No customers yet. Customers will appear here once they make a purchase.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_empty_description = () => `Customers will appear here once they make a purchase.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_col_name = () => `Name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_col_email = () => `Email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_col_purchases = () => `Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_col_spent = () => `Total Spent`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_col_joined = () => `Joined`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_error_title = () => `Customers Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_error_description = () => `Something went wrong loading customers. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_error_back_to_studio = () => `Back to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_title = () => `Customer Details`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_profile = () => `Profile`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_email = () => `Email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_joined = () => `Joined`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_stats = () => `Statistics`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_total_spent = () => `Total Spent`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_purchases = () => `Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_purchase_history = () => `Purchase History`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_col_date = () => `Date`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_col_content = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_col_amount = () => `Amount`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_no_purchases = () => `No purchase history available.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_grant_access = () => `Grant Access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_loading = () => `Loading customer details...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_drawer_error = () => `Failed to load customer details.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_title = () => `Grant Content Access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_description = () => `Grant complimentary access to content for this customer.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_select_content = () => `Select Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_select_placeholder = () => `Choose content to grant access...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_confirm = () => `Grant Access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_success = () => `Access granted successfully.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_grant_error = () => `Failed to grant access.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_search_placeholder = () => `Search customers...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_stat_total_customers = () => `Total Customers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_stat_page_revenue = () => `Page Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_stat_page_avg_spend = () => `Avg. Spend`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_copy_email = () => `Copy email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_copy_email_failed = () => `Failed to copy email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_joined = () => `Joined`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_joined_all = () => `All dates`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_last_7_days = () => `Last 7 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_last_30_days = () => `Last 30 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_last_90_days = () => `Last 90 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_spend = () => `Spend`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_spend_all = () => `All amounts`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_under_10 = () => `Under £10`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_10_to_50 = () => `£10 – £50`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_50_to_100 = () => `£50 – £100`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_over_100 = () => `Over £100`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_bulk_grant_access = () => `Grant Access`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_bulk_grant_title = (params) => `Grant Access to ${params.count} Customers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_bulk_grant_description = () => `Grant complimentary access to the selected customers.`


/**
 * @param {{ completed: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_bulk_grant_progress = (params) => `Granting... ${params.completed} of ${params.total}`


/**
 * @param {{ succeeded: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_bulk_grant_success = (params) => `Access granted to ${params.succeeded} customers.`


/**
 * @param {{ succeeded: NonNullable<unknown>, failed: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_bulk_grant_partial = (params) => `Granted to ${params.succeeded}, failed for ${params.failed}.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_export_csv = () => `Export CSV`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_trend_up = () => `Spending trending up`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_trend_down = () => `Spending trending down`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_page_size = () => `Items per page`


/**
 * @param {{ name: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_view_details = (params) => `View ${params.name} details`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_col_actions = () => `Actions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_action_copy_email = () => `Copy email address`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_action_view_details = () => `View details`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_email_copied = () => `Email copied`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_content = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filter_content_all = () => `All content`


/**
 * @param {{ filtered: NonNullable<unknown>, loaded: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_customers_filtered_count = (params) => `Showing ${params.filtered} of ${params.loaded} on this page`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_general_title = () => `General Settings`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_platform_name = () => `Platform Name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_support_email = () => `Support Email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_contact_url = () => `Contact URL`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_timezone = () => `Timezone`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_social_title = () => `Social Links`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_twitter = () => `Twitter / X`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_youtube = () => `YouTube`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_instagram = () => `Instagram`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_tiktok = () => `TikTok`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_save = () => `Save Changes`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const settings_saved = () => `Settings updated successfully.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_title = () => `Team Management`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_invite = () => `Invite Member`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_invite_email = () => `Email Address`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_invite_role = () => `Role`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_invite_send = () => `Send Invite`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_role_owner = () => `Owner`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_role_admin = () => `Admin`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_role_creator = () => `Creator`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_role_member = () => `Member`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_remove = () => `Remove`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_remove_confirm = () => `Are you sure you want to remove this member?`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_change_role = () => `Change Role`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_empty = () => `No team members yet. Invite your first member to get started.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_col_name = () => `Name`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_col_email = () => `Email`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_col_role = () => `Role`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_col_joined = () => `Joined`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_col_actions = () => `Actions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_error_title = () => `Team Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_error_description = () => `Something went wrong loading team data. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const team_error_back_to_studio = () => `Back to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_title = () => `Analytics`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_revenue_title = () => `Revenue Over Time`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_top_content = () => `Top Content by Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_date_7d = () => `7 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_date_30d = () => `30 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_date_90d = () => `90 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_date_year = () => `Year`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_date_range_label = () => `Date range`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_custom_range = () => `Custom`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_custom_range_heading = () => `Custom date range`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_start_date = () => `Start date`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_end_date = () => `End date`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_apply = () => `Apply`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_compare_toggle = () => `Compare to previous period`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_compare_custom_link = () => `Customise compare range`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_compare_custom_heading = () => `Custom compare range`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_compare_from = () => `Compare from`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_compare_to = () => `Compare to`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_eyebrow = () => `Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_window_last_7d = () => `Last 7 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_window_last_30d = () => `Last 30 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_window_last_90d = () => `Last 90 days`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_window_last_year = () => `Last year`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_window_custom = () => `Custom range`


/**
 * @param {{ label: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_cmd_window_aria = (params) => `Current window: ${params.label}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_empty = () => `No analytics data available for this period.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_tab_revenue = () => `Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_tab_subscribers = () => `Subscribers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_tab_followers = () => `Followers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_empty = () => `Not enough data yet for this window.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_loading_label = () => `Loading chart`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_compare_label = () => `Previous period`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_current_label = () => `Current period`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_tooltip_delta_up = (params) => `+${params.percent}% vs previous`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_tooltip_delta_down = (params) => `${params.percent}% vs previous`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_tooltip_delta_flat = () => `No change vs previous`


/**
 * @param {{ days: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_aria_revenue = (params) => `Revenue over ${params.days} days, total ${params.total}`


/**
 * @param {{ days: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_aria_subscribers = (params) => `New subscribers over ${params.days} days, total ${params.total}`


/**
 * @param {{ days: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_chart_aria_followers = (params) => `New followers over ${params.days} days, total ${params.total}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_col_rank = () => `#`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_col_title = () => `Title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_col_revenue = () => `Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_col_purchases = () => `Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_col_rank = () => `#`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_col_title = () => `Title`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_col_revenue = () => `Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_col_purchases = () => `Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_col_views = () => `Views`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_col_trend = () => `Trend`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_empty = () => `No content in this period yet.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_loading_label = () => `Loading leaderboard`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_no_thumbnail_alt = () => `No thumbnail`


/**
 * @param {{ amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_delta_increase = (params) => `increased by ${params.amount}`


/**
 * @param {{ amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_leaderboard_delta_decrease = (params) => `decreased by ${params.amount}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_error_title = () => `Analytics Error`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_error_description = () => `Something went wrong loading analytics. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_error_back_to_studio = () => `Back to Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_page_description = () => `Measure the pulse of your platform — revenue, audience, and engagement at a glance.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_kpi_revenue_label = () => `Revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_kpi_subscribers_label = () => `Active subscribers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_kpi_followers_label = () => `Followers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_kpi_purchases_label = () => `Purchases`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_section_kpis_label = () => `Headline metrics`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_section_chart_label = () => `Trend over time`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_section_leaderboard_label = () => `Top content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_section_leaderboard_heading = () => `Top content by revenue`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const kpi_loading_label = () => `Loading metric`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const kpi_delta_increase = (params) => `increased by ${params.percent} percent`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const kpi_delta_decrease = (params) => `decreased by ${params.percent} percent`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const kpi_delta_no_change = () => `no change`


/**
 * @param {{ count: NonNullable<unknown>, min: NonNullable<unknown>, max: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const kpi_sparkline_label = (params) => `Trend over the last ${params.count} data points, ranging from ${params.min} to ${params.max}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_aria_label = () => `At-a-glance summary`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_loading_label = () => `Loading summary`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_no_compare = () => `No comparison window selected yet — turn on compare-to-previous to see trends.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_no_data = () => `Still early days — as your audience grows, this is where you'll see your wins.`


/**
 * @param {{ percent: NonNullable<unknown>, amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_revenue_big_win = (params) => `Revenue climbed ${params.percent}% to ${params.amount} — your strongest stretch yet.`


/**
 * @param {{ percent: NonNullable<unknown>, amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_revenue_win = (params) => `Revenue rose ${params.percent}% to ${params.amount}, a healthy step up on last period.`


/**
 * @param {{ amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_revenue_flat = (params) => `Revenue held steady at ${params.amount} — a solid base to build on.`


/**
 * @param {{ percent: NonNullable<unknown>, amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_revenue_loss = (params) => `Revenue eased off ${params.percent}% to ${params.amount} — a quiet window, but the audience is still there.`


/**
 * @param {{ percent: NonNullable<unknown>, amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_revenue_big_loss = (params) => `Revenue dipped ${params.percent}% to ${params.amount} — worth a closer look at what shifted.`


/**
 * @param {{ amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_revenue_first = (params) => `You brought in ${params.amount} this period — a real start to build from.`


/**
 * @param {{ count: NonNullable<unknown>, multiplier: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_subscribers_big_win = (params) => `${params.count} new subscribers joined — almost ${params.multiplier}x last period.`


/**
 * @param {{ count: NonNullable<unknown>, percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_subscribers_win = (params) => `${params.count} new subscribers signed up, up ${params.percent}% on last period.`


/**
 * @param {{ percent: NonNullable<unknown>, count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_subscribers_loss = (params) => `New subscribers eased back ${params.percent}% — still ${params.count} joined this window.`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_followers_win = (params) => `Followers grew ${params.percent}% — early signs of momentum.`


/**
 * @param {{ percent: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_followers_loss = (params) => `Follower growth slowed ${params.percent}% — a quieter window for reach.`


/**
 * @param {{ title: NonNullable<unknown>, amount: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_top_performer = (params) => `Your top performer was ${params.title}, pulling in ${params.amount}.`


/**
 * @param {{ title: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_narrative_top_rising = (params) => `${params.title} is on the rise — watch time up meaningfully vs last period.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_zero_state_heading = () => `Your analytics will appear here.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_zero_state_description = () => `As customers engage with your content, trends and insights will fill in automatically.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const analytics_zero_state_illustration_alt = () => `Faint flat chart lines suggesting a blank analytics view waiting for data.`


/**
 * @param {{ price: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_purchase_button = (params) => `Purchase for ${params.price}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_purchase_button_free = () => `Get Free Access`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_signin_to_purchase = () => `Sign in to purchase`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_processing = () => `Processing...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_error = () => `Checkout failed. Please try again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_error_already_purchased = () => `You already have access to this content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_title = () => `Purchase Complete!`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_description = () => `You now have full access to this content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_watch_now = () => `Start Watching`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_browse = () => `Continue Browsing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_verifying = () => `Verifying your purchase...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_error = () => `We couldn't verify your purchase right now. Check your library — your content should appear shortly.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_go_to_library = () => `Go to Library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_listen_now = () => `Start Listening`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_read_now = () => `Start Reading`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_confirming = () => `Confirming your purchase...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_confirming_description = () => `This usually takes just a few seconds. Please stay on this page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_almost_there = () => `Almost there...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_almost_there_description = () => `Your purchase is being processed. It should appear in your library within a few minutes.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_whats_next = () => `What's Next`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_tip_progress = () => `Pick up where you left off — your progress is saved automatically.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_tip_library = () => `Find all your purchases in your Library, any time.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_tip_devices = () => `Watch on any device — your progress syncs everywhere.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_expired_title = () => `Checkout session expired`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_expired_description = () => `Your checkout session timed out before payment was confirmed. No charge was taken — you can start over whenever you're ready.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_start_over = () => `Start Over`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_success_icon_alt = () => `Purchase confirmed`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const checkout_cancel_back = () => `Back to Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_account = () => `Account`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_library = () => `Library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_studio = () => `Studio`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_log_out = () => `Log out`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_register = () => `Register`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_open_menu = () => `Open menu`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_close_menu = () => `Close menu`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_title = () => `My Library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_error_title = () => `Failed to load library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_error_default = () => `Your library could not be loaded. Please try refreshing the page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_error_unauthorized = () => `Your session may have expired. Please sign in again.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_error_unavailable = () => `The service is temporarily unavailable. Please try again shortly.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_no_thumbnail = () => `No thumbnail`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_empty = () => `Your library is empty.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_empty_description = () => `Content you purchase will appear here.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const library_browse = () => `Browse Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_title = () => `Discover Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_subtitle = () => `Browse premium content from creators and organizations.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_search_button = () => `Search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_search_aria = () => `Search content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_error_title = () => `Failed to load content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_error_description = () => `Some content could not be loaded. Please try refreshing the page.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_empty = () => `No content found. Check back soon.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_empty_description = () => `Try a different search or browse all content.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_empty_search_description = () => `No content matched your search. Try different keywords.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_clear_search = () => `Clear search`


/**
 * @param {{ query: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const discover_empty_search = (params) => `No content found for "${params.query}". Check back soon.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_hero_title = () => `Transform Your Content Journey`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_hero_tagline = () => `Discover and stream premium content from independent creators and organizations.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_hero_explore = () => `Explore Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_hero_join = () => `Join Free`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_features_title = () => `Why Codex?`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_feature_curated_title = () => `Curated Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_feature_curated_desc = () => `Premium content from verified creators, organized by topic and skill level.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_feature_org_title = () => `Organization Spaces`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_feature_org_desc = () => `Browse complete content libraries from your favorite organizations.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_feature_creators_title = () => `Creator Profiles`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const landing_feature_creators_desc = () => `Follow creators across multiple organizations and track your progress.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_title = () => `Simple, Transparent Pricing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_subtitle = () => `Pay only for what you need. No hidden fees.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_free = () => `Free`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_free_price = () => `£0`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_period = () => `/month`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_free_feature_1 = () => `Access free content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_free_feature_2 = () => `Track your progress`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_free_feature_3 = () => `Build your library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_free_cta = () => `Get Started`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator = () => `Creator`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_price = () => `£19`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_feature_1 = () => `Create an organization`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_feature_2 = () => `Upload unlimited content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_feature_3 = () => `Adaptive HLS streaming`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_feature_4 = () => `Analytics dashboard`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_feature_5 = () => `Custom branding`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_creator_cta = () => `Start Creating`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise = () => `Enterprise`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_price = () => `Custom`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_feature_1 = () => `Everything in Creator`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_feature_2 = () => `Multiple organizations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_feature_3 = () => `Priority support`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_feature_4 = () => `Custom integrations`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_feature_5 = () => `SLA guarantee`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const pricing_plan_enterprise_cta = () => `Contact Us`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_title = () => `About Codex`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_lead = () => `Empowering independent creators to share premium content with the world.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_mission_title = () => `Our Mission`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_mission_body = () => `Codex provides a modern platform for creators and organizations to distribute high-quality video content. We handle the infrastructure so creators can focus on what they do best.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_creators_title = () => `For Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_creators_body = () => `Upload, organize, and monetize your content. Set up your organization, invite team members, and build your audience with powerful tools and analytics.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_learners_title = () => `For Learners`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_learners_body = () => `Discover content from creators you trust. Track your progress, build your library, and learn at your own pace with adaptive streaming.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const about_cta = () => `Get Started`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_label = () => `Command palette`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_search_placeholder = () => `Search pages, content, actions...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_search_label = () => `Command palette search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_no_results = () => `No results found`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_hint_navigate = () => `Navigate`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_hint_select = () => `Select`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_hint_close = () => `Close`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_group_pages = () => `Pages`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_group_actions = () => `Actions`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_dashboard = () => `Dashboard`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_content = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_media = () => `Media`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_analytics = () => `Analytics`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_team = () => `Team`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_customers = () => `Customers`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_settings = () => `Settings`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_page_billing = () => `Billing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_action_create_content = () => `Create new content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_action_view_site = () => `View public site`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_action_badge = () => `Action`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const carousel_view_all = () => `View all`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const carousel_default_label = () => `Content carousel`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const carousel_scroll_left = () => `Scroll left`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const carousel_scroll_right = () => `Scroll right`


/**
 * @param {{ selected: NonNullable<unknown>, total: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const table_selected_count = (params) => `${params.selected} of ${params.total} selected`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const table_select_all = () => `Select all rows`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const table_select_row = () => `Select row`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const view_toggle_label = () => `View mode`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const view_toggle_grid = () => `Grid view`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const view_toggle_list = () => `List view`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const back_to_top = () => `Back to top`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const preview_player_load_error = () => `Failed to load preview.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const preview_player_init_error = () => `Failed to initialize preview player.`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const preview_player_loading = () => `Loading preview`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const preview_player_ready = () => `Preview ready`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const preview_player_error_status = () => `Error loading preview`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const video_player_loading_player = () => `Loading player…`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_play = () => `Play`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_pause = () => `Pause`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_unmute = () => `Unmute`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_mute = () => `Mute`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const player_fullscreen = () => `Fullscreen`


/**
 * @param {{ count: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const nav_badge_items = (params) => `${params.count} items`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_sidebar_admin = () => `Admin`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const studio_sidebar_owner = () => `Owner`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const search_placeholder = () => `Search...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const search_clear = () => `Clear search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const search_recent = () => `Recent`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const search_clear_button = () => `Clear`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const brand_editor_auto = () => `Auto`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const brand_editor_customize = () => `Customize`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_form_tags = () => `Tags`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_form_optional = () => `Optional`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_form_tags_placeholder = () => `Add tags...`


/**
 * @param {{ max: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_form_tags_hint = (params) => `Press Enter or comma to add. Max ${params.max} chars each.`


/**
 * @param {{ tag: NonNullable<unknown> }} params
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const content_form_tags_remove = (params) => `Remove tag ${params.tag}`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_home = () => `Home`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_discover = () => `Discover`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_explore = () => `Explore`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_creators = () => `Creators`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_pricing = () => `Pricing`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_library = () => `Library`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_search = () => `Search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_sign_in = () => `Sign In`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_register = () => `Register`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_theme_light = () => `Light mode`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const sidebar_theme_dark = () => `Dark mode`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const mobile_more = () => `More`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const mobile_search = () => `Search`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_placeholder = () => `Search content, creators...`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_recent = () => `Recent`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_content = () => `Content`


/**
 * 
 * @returns {string}
 */
/* @__NO_SIDE_EFFECTS__ */
export const command_palette_creators = () => `Creators`
