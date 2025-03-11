function distribuirEquipos() {
    let nombres = document.getElementById('participantes').value.split(',');
    nombres = nombres.map(nombre => nombre.trim()).filter(nombre => nombre !== ''); // Eliminar espacios extra y nombres vacíos
    let equipos = {};
    let nombresEquipos = ["Chicago No Meo", "Los Chupacabras", "Indiana y Enrique","Los Dribladores Danzantes", "Cazadores de Canastas", "Saltarines de Asfalto", "Gigantes del Golpe", "Reyes del Rebote", "Magos del Aro", "Guerreros del Tablero", "Titiriteros de la Cancha", "Fantasmas del Triple", "Juglares del Juego", "Virtuosos del Vuelo", "Tiradores de Élite", "Enanos Saltarines", "Maestros del Mate", "Los Ágiles Albatros", "Bufones de la Bola", "Dinamos del Dribling", "Cazadores de Sueños", "Los Bailarines del Balón", "Generales del Gimnasio", "Los Locos del Layup", "Los Pintores del Parqué", "Príncipes del Pase", "Los Soñadores de Swish", "Titanes del Tiempo Muerto", "Héroes del Halcón", "Brujos del Bote", "Golpeadores del Garabato", "Eléctricos del Esfuerzo", "Amos del Aire", "Los Fugitivos del Fallo", "Fantásticos del Fadeaway", "Rebeldes del Rim", "Los Saltamontes", "Gigantes Gamberros", "Bromistas del Buzzer","Los Voladores del Viento", "Zapatillas Zumbantes", "Dribladores de Destino", "Canasteros Cósmicos", "Bailarines del Bote", "Titanes del Triple", "Saltadores de Sueños", "Reyes del Ruedo", "Vencedores del Vertiginoso", "Místicos del Mate", "Gladiadores del Golpe", "Piratas del Parqué", "Hechiceros del Hoop", "Nómadas del Net", "Aventureros del Aro", "Brujas del Baloncesto", "Fantasmas del Finteo", "Cometas del Campo", "Lobos del Lay-up", "Jinetes del Jab", "Magos de la Media Cancha", "Sultanes del Swish", "Dragones del Dribleo", "Campeones del Caos", "Ángeles del Aire", "Caballeros del Court", "Profetas del Pase", "Demonios del Dribling", "Barones del Bounce", "Gnomos del Juego", "Rayos Rápidos", "Estrellas del Estilo", "Vikingos de la Victoria", "Paladines del Pivote", "Cazadores de Cometas", "Abejas del Basket", "Torbellinos del Tiempo", "Marineros de la Malla", "Fénix del Free-throw", "Gigantes de la Gracia"];
   
   
    // Mezclar aleatoriamente los nombres de los equipos
    nombresEquipos.sort(() => Math.random() - 0.5);

    // Obtener el número de equipos del input del usuario
    let numeroEquipos = Math.min(parseInt(document.getElementById('numeroEquipos').value), nombres.length, nombresEquipos.length);

    // Seleccionar los nombres de equipos de manera aleatoria
    let equiposSeleccionados = nombresEquipos.slice(0, numeroEquipos);

    // Revolver los nombres para aleatoriedad
    nombres.sort(() => Math.random() - 0.5);

    // Asignar los participantes a los equipos
    for (let i = 0; i < nombres.length; i++) {
        let equipo = equiposSeleccionados[i % numeroEquipos];
        if (!equipos[equipo]) {
            equipos[equipo] = [];
        }
        equipos[equipo].push(nombres[i]);
    }

    // Mostrar los equipos
    let resultados = document.getElementById('resultados');
    resultados.innerHTML = '';
    for (let equipo in equipos) {
        resultados.innerHTML += `<h3>${equipo}</h3><p>${equipos[equipo].join(', ')}</p>`;
    }
}



// Esta función se ejecutará al hacer clic en el botón.

function cambiarModo() {
    document.body.classList.toggle('modo-oscuro');
    let boton = document.querySelector('button');
    boton.textContent = document.body.classList.contains('modo-oscuro') ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro';
}
