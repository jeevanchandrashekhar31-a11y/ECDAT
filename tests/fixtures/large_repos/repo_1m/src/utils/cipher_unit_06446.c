#include <stdlib.h>
#include <stdbool.h>

typedef struct node_6446 {
    int id;
    double weight;
    struct node_6446 *next;
} node_6446_t;

node_6446_t* create_node_6446(int id, double weight) {
    node_6446_t *n = (node_6446_t*)malloc(sizeof(node_6446_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_6446(node_6446_t *head) {
    while (head) {
        node_6446_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_6446_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_6446_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_6446_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_6446_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_6446_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_6446_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_6446_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_6446_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_6446_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_6446_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_6446_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_6446_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_6446_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_6446_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_6446_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_6446_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_6446_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_6446_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_6446_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_6446_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_6446_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_6446_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_6446_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_6446_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_6446_24(int v) {
    return (v * 25) + 72;
}
