<?php
/**
 * Plugin Name: Vesta Accounting — read-only WooCommerce catalog
 * Description: Returns an allowlist of product data to the dedicated source reader.
 */
if (!defined('ABSPATH')) exit;

add_action('rest_api_init', static function () {
    register_rest_route('wc/v3', '/vesta-accounting/catalog', array(
        'methods' => WP_REST_Server::READABLE,
        'permission_callback' => 'vesta_accounting_catalog_permission',
        'callback' => 'vesta_accounting_catalog_page',
    ));
});

function vesta_accounting_catalog_permission($request) {
    $user = wp_get_current_user();
    return $request->get_method() === 'GET' &&
        $user->user_login === 'vesta_accounting_source_reader' &&
        $user->roles === array('vesta_accounting_source_reader') &&
        user_can($user, 'read_private_products');
}

function vesta_accounting_catalog_page($request) {
    if (!function_exists('wc_get_product')) return new WP_Error('vesta_catalog_unavailable','Catalog unavailable',array('status'=>503));
    $page=filter_var($request['page'] ?: 1,FILTER_VALIDATE_INT,array('options'=>array('min_range'=>1,'max_range'=>10000)));
    $size=filter_var($request['per_page'] ?: 30,FILTER_VALIDATE_INT,array('options'=>array('min_range'=>1,'max_range'=>50)));
    $parent=$request['parent']===null?0:filter_var($request['parent'],FILTER_VALIDATE_INT,array('options'=>array('min_range'=>1)));
    if (!$page || !$size || $parent===false) return new WP_Error('vesta_catalog_invalid','Invalid page',array('status'=>400));
    $args = array(
        'post_type' => $parent?'product_variation':'product',
        'post_status' => array('publish','private','draft','pending','future'),
        'fields' => 'ids', 'posts_per_page' => $size, 'paged' => $page,
        'orderby' => 'ID', 'order' => 'ASC', 'ignore_sticky_posts' => true,
        'no_found_rows'=>false,
    );
    if ($parent) $args['post_parent']=$parent;
    foreach (array('modified_after'=>'after','modified_before'=>'before','before'=>'before') as $field=>$bound) {
        if (!$request[$field] || $parent) continue;
        if (!is_string($request[$field]) || !preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/D',$request[$field])) {
            return new WP_Error('vesta_catalog_invalid','Invalid timestamp',array('status'=>400));
        }
        $stamp=strtotime($request[$field]);
        if ($stamp===false) return new WP_Error('vesta_catalog_invalid','Invalid timestamp',array('status'=>400));
        $args['date_query'][]=array('column'=>$field==='before'?'post_date_gmt':'post_modified_gmt',$bound=>gmdate('Y-m-d H:i:s',$stamp),'inclusive'=>false);
    }
    $query=new WP_Query($args);
    $rows=array();
    foreach ($query->posts as $id) {
        $p=wc_get_product($id);
        if (!$p || ($parent && $p->get_parent_id()!==(int)$parent)) return new WP_Error('vesta_catalog_inconsistent','Catalog changed',array('status'=>409));
        $modified=$p->get_date_modified();
        $row=array(
            'id'=>(int)$p->get_id(),'name'=>$p->get_name(),'sku'=>$p->get_sku(),'type'=>$p->get_type(),
            'status'=>$p->get_status(),'price'=>$p->get_price(),'regular_price'=>$p->get_regular_price(),'sale_price'=>$p->get_sale_price(),
            'currency'=>get_woocommerce_currency(), 'stock_quantity'=>$p->get_stock_quantity(),
            'stock_status'=>$p->get_stock_status(),'manage_stock'=>$p->get_manage_stock(),
            'date_modified_gmt'=>$modified?gmdate('Y-m-d\TH:i:s',$modified->getTimestamp()):null,
        );
        if ($parent) $row['attributes']=$p->get_attributes();
        else $row['categories']=array_map(static function ($id) {return array('id'=>(int)$id);},$p->get_category_ids());
        $rows[]=$row;
    }
    $result = new WP_REST_Response($rows,200);
    $result->header('X-WP-Total',(string)$query->found_posts);
    $result->header('X-WP-TotalPages',(string)$query->max_num_pages);
    $result->header('Cache-Control','private, no-store');
    return $result;
}
