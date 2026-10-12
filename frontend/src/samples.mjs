// Synthetic French test corpus: 20 incident families × 5 distinct situations.
// Caller statements only, not medical guidance, diagnoses or dispatch receipts.
const families = [
 ['Malaise', ['Mon collègue vient de tomber dans le couloir et ne me répond pas.', 'Une personne a perdu connaissance dans la file de la boulangerie.', 'Mon père est très pâle et dit qu’il se sent partir.', 'Une passagère se sent mal dans le tramway arrêté.', 'Un homme s’est effondré pendant une réunion.']],
 ['Respiration signalée difficile', ['Ma sœur dit qu’elle n’arrive pas à reprendre son souffle.', 'Mon enfant respire bruyamment depuis quelques minutes.', 'Mon voisin a du mal à parler parce qu’il manque d’air.', 'Une personne dans le hall respire très vite et demande de l’aide.', 'Mon grand-père dit que sa respiration devient difficile.']],
 ['Fumée dans un bâtiment', ['Il y a de la fumée dans notre cage d’escalier.', 'Une fumée noire sort du local à poubelles de l’immeuble.', 'Le détecteur sonne et une odeur de brûlé vient du couloir.', 'De la fumée entre sous la porte de notre appartement.', 'Je vois de la fumée sortir du sous-sol du magasin.']],
 ['Départ de feu', ['Une voiture brûle dans le parking extérieur.', 'Une poubelle prend feu près de l’entrée de l’école.', 'Je vois des flammes sur le balcon de l’immeuble voisin.', 'Un appareil a pris feu dans la cuisine du restaurant.', 'Des herbes brûlent à côté d’un entrepôt.']],
 ['Accident routier', ['Deux voitures viennent de se percuter au carrefour.', 'Une moto est tombée après un choc avec une voiture.', 'Une camionnette a heurté un poteau et bloque une voie.', 'Une voiture s’est retournée sur la route départementale.', 'Un cycliste a été touché par une voiture à un passage piéton.']],
 ['Chute', ['Ma mère est tombée dans la salle de bain et ne peut pas se relever.', 'Un ouvrier est tombé d’un escabeau dans un commerce.', 'Une personne a glissé dans les escaliers de la gare.', 'Un enfant est tombé d’un jeu dans le parc.', 'Un promeneur est tombé sur un chemin et dit avoir mal à la jambe.']],
 ['Menace signalée', ['Quelqu’un frappe très fort à ma porte et me menace.', 'Un homme menace des passants devant le magasin.', 'Une personne me suit et crie qu’elle va me faire du mal.', 'Il y a une altercation et l’une des personnes menace l’autre.', 'Une personne menace mon collègue à l’accueil.']],
 ['Violence au domicile', ['Je suis chez moi et mon compagnon vient de me frapper.', 'J’entends des cris et des coups dans l’appartement voisin.', 'Je suis enfermée dans une pièce et quelqu’un essaie d’entrer.', 'Mon frère est violent et nous avons peur de sortir de la chambre.', 'Je ne peux pas parler fort, une personne me menace dans la maison.']],
 ['Personne à l’eau', ['Une personne est tombée dans le canal devant moi.', 'Je vois quelqu’un dans la rivière qui appelle à l’aide.', 'Un enfant est tombé dans le bassin du parc.', 'Une personne est tombée du quai dans le port.', 'Un promeneur vient de glisser dans l’étang.']],
 ['Odeur inhabituelle', ['Il y a une forte odeur de gaz dans le hall.', 'Une odeur chimique très forte vient du local technique.', 'Une odeur inhabituelle est apparue après des travaux dans la rue.', 'Plusieurs personnes sentent une odeur de gaz devant l’immeuble.', 'Une odeur irritante vient de la cave du commerce.']],
 ['Personne coincée', ['Deux personnes sont bloquées dans l’ascenseur.', 'Un enfant a coincé son bras dans une barrière.', 'Une personne est enfermée dans un local sans poignée intérieure.', 'Un employé a la main coincée dans une porte métallique.', 'Un conducteur ne peut pas ouvrir la portière après un choc.']],
 ['Danger électrique', ['Un câble est tombé dans la rue après le passage d’un camion.', 'Des étincelles sortent d’un coffret électrique sur le trottoir.', 'Un poteau électrique semble pencher au-dessus de la route.', 'De l’eau coule sur une installation électrique du hall.', 'Un fil pend à hauteur des passants devant une école.']],
 ['Inondation', ['L’eau monte rapidement dans le sous-sol où se trouve mon voisin.', 'Une voiture est immobilisée dans une rue inondée.', 'De l’eau entre dans plusieurs appartements au rez-de-chaussée.', 'Une canalisation a éclaté et l’eau bloque la sortie du parking.', 'Le ruisseau déborde près de plusieurs maisons.']],
 ['Enfant perdu', ['Je ne retrouve plus mon enfant dans le centre commercial.', 'Un petit garçon est seul à l’arrêt de bus et pleure.', 'Une fillette dit qu’elle a perdu ses parents dans le parc.', 'Nous avons perdu de vue un enfant pendant une sortie de groupe.', 'Un enfant est seul sur le quai et ne sait pas où sont ses parents.']],
 ['Personne désorientée', ['Une dame âgée est seule et ne sait pas où elle habite.', 'Un homme semble perdu et marche au milieu de la chaussée.', 'Mon voisin ne reconnaît plus son immeuble et paraît confus.', 'Une personne ne sait pas comment elle est arrivée à la gare.', 'Un monsieur cherche son domicile depuis longtemps dans le froid.']],
 ['Saignement signalé', ['Mon collègue s’est coupé la main et saigne beaucoup.', 'Une personne saigne après avoir chuté sur du verre.', 'Mon voisin s’est blessé avec un outil et son bras saigne.', 'Un cycliste est tombé et je vois du sang sur sa jambe.', 'Un enfant s’est blessé au visage après une chute.']],
 ['Douleur signalée', ['Ma femme décrit une forte douleur dans la poitrine.', 'Mon père dit avoir une douleur soudaine très importante.', 'Mon collègue a une douleur au ventre et ne peut plus rester debout.', 'Une personne se plaint d’une douleur intense après un choc.', 'Mon frère dit avoir un très fort mal de tête inhabituel.']],
 ['Animal et danger public', ['Un grand chien poursuit des passants sans personne pour le retenir.', 'Un cheval est au milieu de la route et les voitures freinent.', 'Un chien a mordu une personne devant moi.', 'Un animal est bloqué sur les voies près du passage à niveau.', 'Un essaim se trouve à l’entrée de l’école et plusieurs enfants ont peur.']],
 ['Obstacle dangereux', ['Un arbre vient de tomber sur la chaussée.', 'Une partie de façade est tombée sur le trottoir.', 'Une plaque d’égout manque au milieu du passage piéton.', 'Une barrière de chantier est tombée sur une voie de circulation.', 'Des morceaux de toiture tombent près de l’entrée du bâtiment.']],
 ['Demande à clarifier', ['Je suis perdu et je ne sais pas quel numéro appeler.', 'Je voudrais signaler un bruit inhabituel chez mon voisin.', 'Je rappelle parce que je ne suis pas sûr d’avoir donné la bonne adresse.', 'La communication a coupé et je voudrais expliquer ce que j’ai vu.', 'Je ne vois pas bien ce qui se passe mais plusieurs personnes appellent à l’aide.']],
];
const places = [
 'douze rue des Lilas à Paris', 'vingt-quatre rue des Écoles à Lyon',
 'huit avenue du Parc à Nantes', 'quinze rue du Moulin à Lille', 'trente rue des Jardins à Bordeaux',
];
const names=['Camille','Alex','Samira','Julien','Nora'];
const openings=['Allô ? S’il vous plaît, j’ai besoin d’aide ! ','Écoutez… je suis très inquiet. ','Allô, vous m’entendez ? C’est urgent ! ','S’il vous plaît, aidez-nous… ','Je ne sais pas quoi faire… '];
function dialogue(text,family,variant){
 const place=places[(family+variant)%places.length];
 const quiet=family===7;
 return [
  {text:(quiet?'Je parle doucement… je ne veux pas qu’on m’entende. ':openings[variant])+text,question:'location'},
  {text:`Oui… nous sommes au ${place}. C’est bien là. Je suis sur place, je vais essayer de vous expliquer.`,question:'landmark'},
  {text:'Il y a un arrêt de bus juste en face, et une pharmacie au coin de la rue. Je peux voir le panneau depuis ici.',question:'access'},
  {text:'L’entrée est du côté de la rue, à côté du portail gris. Je ne sais pas si l’autre accès est ouvert.',question:'people'},
  {text:'Je vois deux autres personnes près de moi. Je ne peux pas vous dire s’il y en a davantage, je n’ai pas tout vu.',question:'timeline'},
  {text:'Ça vient de se passer… il y a deux ou trois minutes, pas plus. J’ai appelé dès que j’ai compris qu’il y avait un problème.',question:'observation'},
  {text:`Ce que j’ai vu, c’est ça : ${text} Je suis vraiment inquiet, je préfère vous dire seulement ce dont je suis sûr.`,question:'changes'},
  {text:'Pour l’instant, je ne vois pas de changement. Attendez… non, je ne peux pas en être certain. Je reste attentif à ce qui se passe.',question:'name'},
  {text:`Je m’appelle ${names[variant]}. Pardon si je parle trop vite, je suis un peu perdu. Vous m’entendez toujours correctement ?`,question:'contact'},
  {text:quiet?'Oui, je garde le téléphone avec moi. Je peux rester en ligne, mais je dois continuer à parler doucement.':'Oui, je garde mon téléphone avec moi. Il reste de la batterie et je vous entends. Je ne vais pas raccrocher.',question:'confirmation'},
  {text:`Je confirme : ${place}. ${text} Je n’ai pas d’autre information certaine pour le moment.`,question:'clarify'},
  {text:'D’accord… je reste avec vous. Je vous le dirai tout de suite si quelque chose change. S’il vous plaît, continuez à me parler.',question:'handoff'},
 ];
}
// Interleave families, so the first arrivals are already varied.
export const samples = Array.from({length:5},(_,variant)=>families.map(([cat,variants],family)=>({
 id:`ORANGE-${String(variant*20+family+1).padStart(3,'0')}`,
 cat, synthetic:true, family:family+1,
 voice:variant%2?'fr_male':'fr_female',
 voiceStyle:family===7?'restrained':family===19?'concerned':variant%2?'rushed':'urgent',
 durationMs:(150+variant*15+(family%3)*15)*1000,
 facts:{incident:variants[variant],address:places[(family+variant)%places.length],name:names[variant],
   landmark:'un arrêt de bus en face et une pharmacie au coin de la rue',access:'entrée côté rue près du portail gris',
   elapsed:'deux ou trois minutes',otherPeople:'nombre exact inconnu'},
 turns:dialogue(variants[variant],family,variant),
}))).flat();
if(samples.length!==100 || new Set(samples.map(s=>s.turns[0].text)).size!==100)throw Error('Expected 100 distinct test calls');
