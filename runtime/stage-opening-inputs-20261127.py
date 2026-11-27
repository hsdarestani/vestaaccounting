import base64, zlib, hashlib, struct, collections
data=zlib.decompress(base64.b64decode('eNqNmQ10VdWVx/97n3vPvfu85OWFQABBBBUTNYUgMUaRCZCmTWpEjCJggAajA4IfgYBEYjEFojiNQDFRNH4g+IGgY1SsYNeMdNrVurp0DbVOl3bNWHSqZVlnZI3Tli47H+edm/u4z9TOrPVbO/vdd89595yzz3/vc/MqdhcBW0uAWWcAmTLg9QuAXZcA874GTJwLvLMIOLIE2LcM2HEDULkOGHM7gG8BR7cAh7YCu3ttHztsHw/bPp4ATj5t+3keGHwJWPGa7euHQPiPwIm3bH+/sP390vb3nu3vA6D1Y+D4f9k+hLC1kLBwFKH8dEJmEuHk2YRj5YTBSkJ3DWHFpYSwiXBkAWHHNwmdbYTKWwljOghYTzi6kXBoE2H3XbbNc7bNy4SaHxBOvEF456ht97Zt98+EhuO23Sf2/s/tvYqxsIhx7EzGimrGxDmME42MI1cy9s1ndC5hYDXjaCfj0B2MrVvs/b2MzC7GyQHG63sZg08zdh1gdD9v279m273FaH2PUfmRbfc72+6PjHZfYVahwrwqhdYWhfZNCif7FbqfUQj/TuGdHynsOKrQ+bbCmF8rHP1UYfcfFMpTHgYneKi5wMOReg87LvfQsMjD8RUejt7kYWG3h0yvh5PbPRy7z8OJVz3gAw9bf+eh3PcxsdJHWOVjX52PygU+Dq300X6bj1kbfZRv8vH6d30M9vuY96SP1jd8HP+V/f4zHye1xq5Sje7TNHbM1hjcrnHkexpH/0XjmBfgxPkBOmsD4KoAx68JcPTaALPWBNh1b4CJjweofN1+/jRA5g8B5pWGaJ0Zov36ECfXhxjcHKL7OyFqHgix48UQx98Msftdex2C1osEx9YJ8CNB5reCyosNDjUZvN5hMLg6hSO7Umh4NoWjr6Vw7KMUun+fAi4sQGZxAeadLMCJjWm0X1KEk1NHov3BkRh8ajS694zFL2f2aW+q5qk6nKX5Ih38rS4fqzfRQxJRMhE1Pp1fSp+SItWidYv2FV3EWio1V+rMJOgOOrdHls7Uupc2U4Us6KLD9DVdWagJ+qyJSF2ux09BL7dJbYa3U52eOEVvo1Bbzl+HQTpbj56INRnSPk8s1zKGD1MRn90pz1JaH2GfR3eh9FJdzfqsLfgZdaDyHP1TzkjDKL1gqi5Zh3Mu0FPO1+ft0npAPqNL9INUqh+gEr6hT4+opzPq6Tk6zXarvdP08nX4mMfpX1ABXuVyXdSB1+x396iMvOvXoWgLXbkAA0HKkOMVtQN/zCzFD1Uvrm7GXTwJ5Z3Yl6nGQGoqpwr5DWrHU1ShVQXftBm1D4IfxPhNKKzWV2XoH2ia8DRR0yRdguU+3W1H9gIFkgrk7800KZgm06fJ9+1NH1MZ7gpDoaXyWFAlqkqoSmo7sJm/hc91qfyehH9DmzCiilNV7FVZR2YtkvI2+pAzMJ0Yd6HcOltotrxpZ2dKnX7L/tlwGBUzZBetEV4jORvxqufuTlK4SGiRsLM/V6VcvgqXN2AHLZaIf6NJ8EuFS4VK5UNfdHgY3XQmnqRv63FatBal5U+8AC/zMqFl8ibX4J/sM7/Mk+UR2orFc+kHVC05GruEHPdQjUSwsw+oajlvtrBDxbef2SwUs4v79E/D+ME+VH26uE9fMZmn12FUn6YmSC/SxTijQVSDhHfh0j69dLGoxZKuQ8Vcobmi5kp6GfRqlGyFtMA7Sz9Bf6MnNyGoxldnCjm6aS9oL/t7ERHEjrcXhXsx3ln7cdwjVH2tUD4vUT3e53qa0yLUIs3NuHaGUEym1nCtIcct8ehzFLl7Sp4UcmyLpin1HZRcZchR7FasYFhLrtH/ThM4PUHurEDdZqg+oT75n+QtI+vEG9auIDG5a6ZJo0/j2kRWoahBKKYgsXYRpU1CTcLOWtKxk2OEm+uIH6dqRNVIqlHK62Wk67FonqF5pmi2lMVrYm1Bvah6oXq5bKVQPoWNohrl9DXyAldLOF24FiPahGLkXiFH4Rwhx141X2i+8HwpHDbk9G12a2JiHP3s7H/bbcdu81n22SEW3Sh0o/CNIiuFV0pBvxQvk68kgtXyoVeH6keFHpXN+mahGHUlr+zT6Wli9/c2rxUHea1UluFtulrY0ozigIq34Ld8AI/krUWdUJ18u7hfyBE5h+0AUwPi19pRy9nNYMeF9bK0VN7VNaKn4/ImKAPjEz+KCL9eQtdbjvQc+Xm4UfwA57RJwYDQgLwXLXvJAqHlwstlQjO8BWBHYO06pAz4L9NMHIBXoKSWq1ynqS7xbdSWwrMUIBepAQlZLVsHrwL1u2VnYNXLCcoHXr1k2sTr04tbhRymXSgm0yvkCIYtZHYtnT1zeXYEeXjwPLCHoVYG6URARxQtFV6aFd4IvxNSgePhd9kWF5M9UD7B1Yby0S72OA7C1HihfL5Pz8hJf7ShYXApGmO/aYtQPn4Xnf4s0nXCifXr8Z9GdSPGdEE6EbQgbMWkOqY6nhQtr5usUS7qLQNqifASIUfolD2HbpJP+FF6nNeioAFeA1QdCtdhlJPUn0XiqjvFu93Q7WZUp6RcGJp+OcutQ52zqSb8mG2Iug87bQCMS2zXM1qM53751CM04D91/Nlas5KV21clzpq4pXECkESvBDtUF2XtSmyllXjOBlLJVkNbjYnnf6uym2RAruxHcJBOH20+o2qTozAhXmVx+slRmIi3CFsXFa0QyufXoc1KTjCimVB2GjYIxfBYiFMMqxs/kVjM3k4vEq8eFQM2H8fpxcINyAyTueFk3BbJdIlaZuhLKHBJ16Jix6ZhvU3IwbEjiSIgiQyLv3RuUJugbCrpQdCTtaU3Gb7JKBs2Ce0dsQdqD4oWGl5ogilCMa/wMph+hCH0XOG5oncautPQE6Yodoqdw/HHX3mJnBFYTYrhezBhi3CMeQphLO49xbcKxXxebNfAPfeO8D7D9xmKrbcBNA28R8iSgXLLmCt/2K6kgW+gDchhhe39aHe/4c3AW1FVU9UE7aKFnQ0SPs8F3ewoHYLzt1zaWTUJNDbLf4Tt8BypDvzGux8lB/BywUwEM2EMNk9IrAU7+6+2v1etmnzCjegL401uyTjNtQSJPM7fBF1j+BpjrXbftrt4tQN9yt+HUWvFJqTr4iIqx3Wuxzdzu+L9Mc3yEXXBG3bn8Cth/iN31iFohp94JsvcWntOBa86RdCGsA2HCzvwLvVAepBytsCGWg90D9I9GNWDkT0Ie8A9MG4BbfypNvKsXYvgMUOPGRWnCO+gUMxt7kp5IiIj1EtCjrNeBL8IbY/YuyV4COpehPfjqlXwWjDyfhQM2/2pi4UuFuVsRIEr8CyD+nlD3zMvGKeURwrdn8DNfP0rQo7CtfA64O+GedjQw8Z7Du/pjI3GIUZGwemwBwczQ9QMOUk3YEcwAiPWCjnsupXeIXSHjC0A/z9QNgE3I1qcpW3wa1CYSCk2vRygAxJxxQEpdM6oA1JSZgMbNpOHXVK8X2i/jPOFfAk6hDqEW6TgQkhCA/R+4f0SnmEoxisTKhP9VfgzIE7DwmET6seO52RdzQfPhzQjmtawQuxxkiukuMCKiKGvGH8pvPkILjN0mZFvGPqG8edDbQCvBm9wrIZaDX+1+M7RLvWLbXKuIYeOF8wS7W+/zdb9Q3khSKRuZWegTEJXwuXI3WmcVYmcYs4TOk+M0y6/BeIualdM2p/gCujsjrC1X3YjeF3QiT0cUZKB9qDLECROCzpeqvBu2232sSXe8Gm3LnbaC50T2S9g70k5J9wvKvZzKPsY3UIJ2JH8GCRn7HpDMXqTFWFDMbofk7cLxdgjsyVYZ2id8evhH0TwchZTiqIpeMjGluRLg7bF4C1CDnOdjFgvtF6mbpGf0CabhGSKq7HVEgQJyTmnwcazhGXwHsDUhww5eIuhfHiR4QFDDm425Iiu8AG7oQytNZwYCi82lA+3GWoz3GUoJs9fZCgm8nPfKvfY/Lihxw33psnBB9MUE13kKYby+TPPMPxK/jDVC2ly8ApD+fBsQ7OzlmOdzMEbDMXwjYYc7IagVhpysCPp50itMZSAY8TO7RJDMX7cNurEc3Vb7qWDf6uhmKK5hmJ4JytXcETzHxHEX9FOtieDYIahGYYd3t1Grza02kTHM642HFd/vrMpp0kRPM1QjPXVuYadQnCLoZZTARPcYugWw7cYb70hB683fhSNybVwkV6431AM77di47pyeG7T8PUuxq5PBNt2h/2t2CqXej0XltnIXGtUbh0d0m+436iBNA2kfZcL7FRHsz1k6wzlwytOQQnHoisMO+h0jh64oCy7+nqjsG/IN9xhyJFcBRUP028ZKjOy9UaDoQYTzDQ00/BMo92cR6sg1UblViqOxqyN7/HiIA9qDNXYFcwSRFvVWW+a8Vz/0a9w3HPuJ7jJkCNyvEQg+a7P6Mkzif4p8q81lI8Xv5+xBE8ackSbmt07GGvDjJ0QKbCykDGUyVqL6jSF0bhas9jxUqtRa9xvrXE/tybhOOvvNmG9oXrD9UbtMWwpNbTHUKmTlD1G2W+rjCJDZKKg1UsN/ZVRVdnrXGV0vfHiQVFuUDXGX25oueGEDd3URXNoUQ0mvCLNQzOfpsVpO3Xc6eg31G90r6FeW1w56w6D3qJTcmcdtWQIbnQ73WbUxi9ajq0XHXydVY7o+Bu4EFV1Q3FrncBG+LKhQSmHdfTa+NTtns0S6ZW1ysbPbKNyujE3O5nZ+awfErGkZKnGLFYQeI4hBx+S0fG0+LYiiOLtGUPPmLEb7VRIdkUiur7kDLbtzzEzwbAjVvJsOqSN9cPI7biBhEonZf9mMyTg9yWYfYrsLnPLN/ScCxIsdCTzzu50lmhPuega2kFx0qT5w8iJzHmO3IhakrjyITne8Qlymtmcz3Vx+k6I6nDUF650/1/cYdQdWcsXG/oCuQeO1tqVmeTKTCpzHPgSonQfPUCiBM6mhjgmU7mCITd1TtmGCpKEImWdPke/k+5ed7E33uA2aVonspEz3vjjDY83nptPZe0mw5viV01Nbsc1ubDJ2aY4iiJnRmzrnGRFjv2t9oS1PJpwZjgtimwUZtqwdjaVJfsvlMBRmhW0LPaU7BQ+i0thWc1sNHyhTXzCUX2SZFGCZSb7+sNl6iFsh/McXz+leFmt6I1ZOgRbtbROezqCLVEdklDLoRiuSmD1ebpVmzRdaYaoySM7+bdlx64SZPOypTaL1VsVsc0eNYxqc3JU42zdEBw7ao6ZuJNrB3j6AM8bKxyHzZ9oQNNIPbOBeJ1QDlv93Ml5tpmSLxyS/uREw2sSfsG9VJjs06GHXZEeoQR+/Ip7xKq0WpXmVTp6c1cUv3nKUZR4H+7ln8DHDvuVwsTNEZJ4B6a20yhX6CQJh12hPq1WSDBJKB9b4lCF+fpDWr9EwaD24tpX/bX21pBaQtyqvYOUTrw7+F9klxrP'))
assert hashlib.sha256(data).hexdigest()=='b6ae22bf5f476f9deca573a775e25ee70645bf704234e679905790fa58f861d5'
n=struct.unpack_from('<H',data)[0]
prices=struct.unpack_from('<'+'I'*n,data,2)
i=2+4*n; id=0; rows=[]
while i<len(data):
 d=0; shift=0
 while True:
  b=data[i]; i+=1; d|=(b&127)<<shift; shift+=7
  if b<128: break
 id+=d; price=prices[data[i]]; f=data[i+1]; i+=2
 rows.append((id,price,['reference','owner_entered','estimate'][f&3],bool(f&4),'variations' if f&8 else 'products'))
assert len(rows)==len(set(r[0] for r in rows))==2434
assert sum(r[1] for r in rows)==624014000
assert collections.Counter(r[2] for r in rows)=={'reference':311,'owner_entered':1051,'estimate':1072}
assert sum(r[3] for r in rows)==91
print("""BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(20261127);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM accounting_cutover WHERE id=1 AND effective_at_utc='2026-11-23 20:30:00+00'::timestamptz AND currency_unit='TOMAN') THEN RAISE EXCEPTION 'Unexpected cutover'; END IF; END $$;
CREATE TABLE IF NOT EXISTS opening_input_costs_v1 (
 external_id bigint PRIMARY KEY CHECK(external_id>0),
 unit_cost_toman bigint NOT NULL CHECK(unit_cost_toman>0),
 cost_status text NOT NULL CHECK(cost_status IN ('reference','owner_entered','estimate')),
 priority_review boolean NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('products','variations')),
 imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS opening_input_balances_v1 (
 evidence_date date NOT NULL,
 line_key text NOT NULL,
 account_kind text NOT NULL CHECK(account_kind IN ('bank','cash','gateway','supplier_payable')),
 display_name text NOT NULL,
 amount_toman numeric(20,2) NOT NULL CHECK(amount_toman>=0),
 evidence_note text NOT NULL,
 PRIMARY KEY(evidence_date,line_key)
);
CREATE TEMP TABLE expected_costs AS SELECT external_id,unit_cost_toman,cost_status,priority_review,source_kind FROM opening_input_costs_v1 WITH NO DATA;
COPY expected_costs FROM STDIN;
""")
for r in rows: print(r[0],r[1],r[2],'t' if r[3] else 'f',r[4],sep='\t')
print(r'\.')
print("""INSERT INTO opening_input_costs_v1(external_id,unit_cost_toman,cost_status,priority_review,source_kind)
SELECT * FROM expected_costs ON CONFLICT(external_id) DO NOTHING;
DO $$ BEGIN IF (SELECT count(*) FROM opening_input_costs_v1)<>2434 OR EXISTS(SELECT * FROM expected_costs EXCEPT SELECT external_id,unit_cost_toman,cost_status,priority_review,source_kind FROM opening_input_costs_v1) THEN RAISE EXCEPTION 'Cost input differs'; END IF; END $$;
CREATE TEMP TABLE expected_balances AS SELECT * FROM opening_input_balances_v1 WITH NO DATA;
INSERT INTO expected_balances VALUES
('2026-11-26','bank-7640','bank','بلو بانک 7640',89551964.6,'reported 5 Azar; time unknown; full card number omitted'),
('2026-11-26','bank-5389','bank','بلو بانک 5389',419995750,'reported 5 Azar; time unknown; full card number omitted'),
('2026-11-26','bank-3','bank','بانک ۳',0,'not held'),
('2026-11-26','cash','cash','پول نقد شرکت',0,'reported'),
('2026-11-26','zibal','gateway','زیبال',28019612.1,'reported; reconcile settlement'),
('2026-11-26','snapp','gateway','اسنپ‌پی',262846900,'net 1–30 Aban; 12 percent fee; two-month settlement; no second fee deduction'),
('2026-11-26','torob','gateway','تروپی',50333525,'18 percent fee; monthly day 2; net needs confirmation'),
('2026-11-26','digipay','gateway','دیجی‌پی',28624944.5,'7 month settlement; net assumed; exact maturities unknown'),
('2026-11-26','shopino','gateway','شاپینو',115690385,'ready for settlement; 19.8 percent with VAT; days 10–15; no second fee deduction'),
('2026-11-26','supplier-1','supplier_payable','محمدجواد معزی',287216000,'goods purchased; no due date'),
('2026-11-26','supplier-2','supplier_payable','مهنوش لطفی',39240000,'goods purchased; no due date'),
('2026-11-26','supplier-3','supplier_payable','محمدجواد صبوری',124520000,'goods purchased; no due date');
INSERT INTO opening_input_balances_v1 SELECT * FROM expected_balances ON CONFLICT DO NOTHING;
DO $$ BEGIN IF (SELECT count(*) FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26')<>12 OR EXISTS(SELECT * FROM expected_balances EXCEPT SELECT * FROM opening_input_balances_v1) THEN RAISE EXCEPTION 'Balance evidence differs'; END IF; END $$;
COMMIT;
BEGIN READ ONLY;
SELECT 'staged_costs='||count(*)||' estimates='||count(*) FILTER(WHERE cost_status='estimate')||' priority_review='||count(*) FILTER(WHERE priority_review) FROM opening_input_costs_v1;
SELECT 'staged_balances='||count(*)||' bank_gateway_cash='||sum(amount_toman) FILTER(WHERE account_kind<>'supplier_payable')||' payables='||sum(amount_toman) FILTER(WHERE account_kind='supplier_payable') FROM opening_input_balances_v1 WHERE evidence_date='2026-11-26';
SELECT 'posted_journals='||count(*) FROM journals WHERE status='posted';
SELECT 'capture_observed_at='||observed_at||' cutover_at='||cutover_at FROM opening_capture;
SELECT 'capture_items='||count(*)||' positive_quantity='||count(*) FILTER(WHERE stock_quantity>0)||' unknown_quantity='||count(*) FILTER(WHERE stock_quantity IS NULL) FROM opening_capture_items;
SELECT 'positive_stock_cost_matched='||count(*) FILTER(WHERE c.external_id IS NOT NULL)||' positive_stock_cost_missing='||count(*) FILTER(WHERE c.external_id IS NULL)||' indicative_value_toman='||coalesce(sum(i.stock_quantity::numeric*c.unit_cost_toman),0) FROM opening_capture_items i LEFT JOIN opening_input_costs_v1 c ON c.external_id::text=i.external_id AND c.source_kind=i.source_kind WHERE i.stock_quantity>0;
COMMIT;
""")
