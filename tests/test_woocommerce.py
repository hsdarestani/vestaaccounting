import unittest
from vesta.woocommerce import order_reference,catalog_reference,WooReader
from vesta.ledger import RuleError

class WooTest(unittest.TestCase):
    def test_guest_and_exact_variation_without_private_fields(self):
        order={'id':101,'customer_id':0,'status':'processing','currency':'IRR','payment_method':'gateway','total':'10000','discount_total':'1000','shipping_total':'2000','total_tax':'0','billing':{'email':'synthetic@example.invalid'},'line_items':[{'id':3,'product_id':4,'variation_id':7,'quantity':1,'subtotal':'9000','total':'8000'}]}
        normalized=order_reference(order,'IRR'); self.assertEqual(normalized['party_ref'],'wc-guest-order:101'); self.assertEqual(normalized['amounts']['total']['toman'],1000); self.assertEqual(normalized['lines'][0]['variation_id'],7); self.assertFalse(normalized['financial_confirmation']); self.assertNotIn('billing',normalized)

    def test_unknown_stock_and_distinct_variations(self):
        parent={'id':1,'name':'sample'}; a=catalog_reference(parent,{'id':2,'stock_quantity':None}); b=catalog_reference(parent,{'id':3,'stock_quantity':5})
        self.assertNotEqual(a['variation_id'],b['variation_id']); self.assertIsNone(a['reported_stock']); self.assertIsNone(b['opening_cost'])

    def test_https_required(self):
        for url in ['http://example.invalid','https://user:pass@example.invalid','https://example.invalid/?token=abc']:
            with self.assertRaises(RuleError): WooReader(url,'synthetic','synthetic')
