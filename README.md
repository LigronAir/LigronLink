# LigronLink

Plataforma de coordinación del ecosistema LigronAir.

Estado: V0.1 - Servicio Registro

## Paquetes LigronPi

Los paquetes de actualización viven en el bucket privado R2
`ligronpi-releases`; D1 almacena sólo metadatos, hash y auditoría. El Worker
entrega un ZIP únicamente a la LigronPi autenticada que pertenece a la cuenta
de la versión publicada. Por cada cuenta y canal se conserva el paquete activo
y los dos inmediatamente anteriores para rollback; los objetos más antiguos
se eliminan de R2 al publicar una versión posterior. Las filas históricas de
D1 se conservan como registro, pero no apuntan necesariamente a un objeto aún
disponible.
