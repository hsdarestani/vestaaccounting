"""Explicitly invoked HTTPS GET-only WooCommerce snapshot collector.

This collector never posts financial documents or modifies WooCommerce. The
actual store and API key must be verified by an authorized operator first.
"""
import base64
import json
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from .ledger import RuleError, normalize_amount, stamp

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise RuleError('unexpected API redirect; no credentials forwarded')

def positive_id(value):
    if type(value) is not int or value<=0: raise RuleError('missing stable WooCommerce ID')
    return value

def order_reference(order,unit):
    """Commercial facts only; paid status is not independent receipt evidence."""
    ident=positive_id(order.get('id')); customer=order.get('customer_id',0)
    if type(customer) is not int or customer<0: raise RuleError('invalid customer ID')
    amounts={name:normalize_amount(order.get(name),unit) for name in ('total','discount_total','shipping_total','total_tax')}
    items=[]
    for item in order.get('line_items',[]):
        qty=item.get('quantity'); variation=item.get('variation_id',0)
        if type(qty) is not int or qty<=0 or type(variation) is not int or variation<0: raise RuleError('invalid line identity or quantity')
        items.append({'line_id':positive_id(item.get('id')),'product_id':positive_id(item.get('product_id')),'variation_id':variation,'quantity':qty,'subtotal':normalize_amount(item.get('subtotal'),unit),'total':normalize_amount(item.get('total'),unit)})
    return {'order_id':ident,'party_ref':f'wc-customer:{customer}' if customer else f'wc-guest-order:{ident}',
        'status':order.get('status'),'created_gmt':order.get('date_created_gmt'),'modified_gmt':order.get('date_modified_gmt'),
        'currency_reported':order.get('currency'),'payment_method':order.get('payment_method'),'amounts':amounts,'lines':items,
        'financial_confirmation':False}

def catalog_reference(parent,variation=None):
    row=variation if variation is not None else parent; quantity=row.get('stock_quantity')
    if quantity is not None and type(quantity) is not int: raise RuleError('invalid reported stock quantity')
    return {'product_id':positive_id(parent.get('id')),'variation_id':positive_id(row.get('id')) if variation is not None else 0,
        'name':parent.get('name',''),'sku':row.get('sku',''),'reported_stock':quantity,'manage_stock':row.get('manage_stock'),
        'opening_cost':None,'quantity_is_sellable_snapshot':True}

class WooReader:
    def __init__(self,origin,key,secret,*,max_pages=100,timeout=15):
        url=urlsplit(origin)
        if url.scheme!='https' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('','/'):
            raise RuleError('explicit HTTPS storefront origin required')
        if not key or not secret or not 1<=max_pages<=1000: raise RuleError('read-only credentials and page bound required')
        self.origin=origin.rstrip('/'); self.auth='Basic '+base64.b64encode((key+':'+secret).encode()).decode(); self.max_pages=max_pages; self.timeout=timeout
        self.opener=build_opener(NoRedirect())

    def pages(self,path,**params):
        if not re.fullmatch(r'orders|products|products/[1-9][0-9]*/variations',path): raise RuleError('unsupported read-only collection')
        for page in range(1,self.max_pages+1):
            url=self.origin+'/wp-json/wc/v3/'+path+'?'+urlencode(params|{'page':page,'per_page':50})
            request=Request(url,method='GET',headers={'Authorization':self.auth,'Accept':'application/json'})
            with self.opener.open(request,timeout=self.timeout) as response:
                raw=response.read(8*1024*1024+1)
                if len(raw)>8*1024*1024: raise RuleError('API response exceeds bound')
                data=json.loads(raw)
                if not isinstance(data,list): raise RuleError('invalid API collection')
                total=response.headers.get('X-WP-TotalPages')
            yield from data
            if total is not None and page>=int(total): return
            if len(data)<50: return
        raise RuleError('page bound reached; snapshot incomplete')

    def catalog(self):
        started=stamp(); rows=[]
        for parent in self.pages('products',status='publish',orderby='id',order='asc',_fields='id,type,name,sku,manage_stock,stock_quantity'):
            if parent.get('type')=='simple': rows.append(catalog_reference(parent))
            elif parent.get('type')=='variable':
                for variation in self.pages(f"products/{positive_id(parent.get('id'))}/variations",orderby='id',order='asc',_fields='id,sku,manage_stock,stock_quantity'):
                    rows.append(catalog_reference(parent,variation))
        return {'started_at':started,'finished_at':stamp(),'point_in_time_atomic':False,'rows':rows}

    def orders(self,modified_after,modified_before,unit):
        if not modified_after or not modified_before or modified_after>=modified_before: raise RuleError('bounded reconciliation window required')
        return [order_reference(row,unit) for row in self.pages('orders',modified_after=modified_after,modified_before=modified_before,dates_are_gmt='true',orderby='modified',order='asc',_fields='id,status,customer_id,date_created_gmt,date_modified_gmt,currency,payment_method,total,discount_total,shipping_total,total_tax,line_items')]
