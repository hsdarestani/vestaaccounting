<?php
// Runs once, as the storefront container's non-root PHP user. Stdout is
// redirected to a root-only file on the host, never to CI or an HTTP response.
error_reporting(E_ERROR | E_PARSE);
ini_set('display_errors', '0');
ini_set('log_errors', '0');
$_SERVER['HTTP_HOST'] = 'vesta-cosmetics.ir';
$_SERVER['HTTPS'] = 'on';
$_SERVER['SERVER_PORT'] = '443';
$_SERVER['REQUEST_URI'] = '/';
ob_start();
require '/var/www/html/wp-load.php';
ob_end_clean();
if (wp_parse_url(home_url(), PHP_URL_HOST) !== 'vesta-cosmetics.ir' || !function_exists('wc_api_hash')) exit(20);

$login = 'vesta_accounting_source_reader';
$role_slug = 'vesta_accounting_source_reader';
$caps = array('read' => true, 'list_users' => true);
foreach (array('product','product_variation','shop_order','shop_coupon','shop_order_refund') as $post_type) {
    $object = get_post_type_object($post_type);
    if ($object && isset($object->cap->read_private_posts)) $caps[$object->cap->read_private_posts] = true;
}
$role = get_role($role_slug);
$taxonomy = get_taxonomy('product_cat');
if (!$taxonomy || empty($taxonomy->cap->manage_terms) ||
    $taxonomy->cap->manage_terms === $taxonomy->cap->edit_terms ||
    $taxonomy->cap->manage_terms === $taxonomy->cap->delete_terms ||
    $taxonomy->cap->manage_terms === 'manage_options') exit(26);
$term_reader = $taxonomy->cap->manage_terms;
// WooCommerce checks a separate management/listing capability for category GETs.
// Never grant the edit/delete capabilities or change roles of ordinary users.
if ($role && !array_diff_assoc($role->capabilities,$caps) && !array_diff_assoc($caps,$role->capabilities)) {
    $members = get_users(array('role' => $role_slug, 'number' => 2, 'fields' => array('user_login')));
    if (count($members) !== 1 || $members[0]->user_login !== $login) exit(27);
    $role->add_cap($term_reader);
}
$caps[$term_reader] = true;
if (!$role) $role = add_role($role_slug, 'Vesta Accounting (read-only source)', $caps);
if (!$role || array_diff_assoc($role->capabilities,$caps) || array_diff_assoc($caps,$role->capabilities)) exit(21);
$user = get_user_by('login', $login);
if (!$user) {
    // Do not invoke notification or marketing actions for a machine identity.
    remove_all_actions('user_register');
    $id = wp_insert_user(array(
        'user_login' => $login, 'user_pass' => bin2hex(random_bytes(32)),
        'user_email' => 'vesta-accounting-source@service.invalid',
        'display_name' => 'Vesta Accounting source reader', 'role' => $role_slug,
    ));
    if (is_wp_error($id)) exit(22);
    $user = get_user_by('id', $id);
}
if (!$user || $user->roles !== array($role_slug) || array_diff_key($user->allcaps, $caps + array($role_slug => true, 'level_0' => true))) exit(23);

global $wpdb;
$description = 'Vesta Accounting: dedicated read-only synchronization';
$table = $wpdb->prefix . 'woocommerce_api_keys';
$wpdb->hide_errors();
if (getenv('VESTA_READONLY_CHECK_ONLY') === '1') {
    if ($wpdb->get_var($wpdb->prepare("SELECT permissions FROM `$table` WHERE user_id=%d AND description=%s LIMIT 1", $user->ID, $description)) !== 'read') exit(28);
    exit(0);
}
// Do not rotate an existing integration or create duplicate keys on retry.
if ($wpdb->get_var($wpdb->prepare("SELECT key_id FROM `$table` WHERE user_id=%d AND description=%s LIMIT 1", $user->ID, $description))) exit(24);
$key = 'ck_' . wc_rand_hash();
$secret = 'cs_' . wc_rand_hash();
$added = $wpdb->insert($table, array(
    'user_id' => $user->ID, 'description' => $description, 'permissions' => 'read',
    'consumer_key' => wc_api_hash($key), 'consumer_secret' => $secret,
    'truncated_key' => substr($key, -7),
), array('%d','%s','%s','%s','%s','%s'));
if ($added !== 1) exit(25);
echo json_encode(array('key' => $key, 'secret' => $secret), JSON_UNESCAPED_SLASHES);
