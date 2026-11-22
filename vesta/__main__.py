import argparse
import getpass
import os
from .ledger import Ledger
from .auth import add_user

parser=argparse.ArgumentParser(description='Vesta Accounting evaluation CLI')
parser.add_argument('--db',default=os.environ.get('VESTA_DB','data/evaluation.sqlite'))
sub=parser.add_subparsers(dest='command',required=True)
sub.add_parser('init')
user=sub.add_parser('user'); user.add_argument('username'); user.add_argument('role',choices=['owner','accountant','operator','auditor','admin'])
args=parser.parse_args(); ledger=Ledger(args.db); ledger.initialize()
if args.command=='user':
    a=getpass.getpass('Password (minimum 12 characters): '); b=getpass.getpass('Repeat password: ')
    if a!=b: parser.error('passwords differ')
    add_user(ledger,args.username,a,args.role)
